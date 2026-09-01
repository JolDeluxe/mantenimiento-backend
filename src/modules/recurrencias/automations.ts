// src/modules/recurrencias/automations.ts
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { normalizarFechaLogica } from "./helper";
import { materializarCicloInterno } from "./02_create";
import { resolverOcurrenciaConAjuste } from "./ajustes-helper";
import { resolverPoliticaMaterializacionRecurrencia } from "./materialization-policy";

/**
 * Evalúa reglas activas y materializa como máximo un ciclo vigente por regla.
 * 
 * COMPORTAMIENTO PARA REGLAS ATRASADAS:
 * - No recupera backlog histórico.
 * - Frecuencias cortas: como máximo la última ocurrencia vencida del mes vigente.
 * - Mensual: como máximo la ocurrencia vencida del mes vigente.
 * - Trimestral: como máximo la ocurrencia vencida del trimestre vigente.
 * - Idempotente por (reglaRecurrenciaId + fechaCicloLogica).
 * - Avanza proximaFechaEjecucion al primer ciclo futuro posterior al candidato.
 */
export async function procesarRecurrenciasProgramadas() {
  console.log("[CRON RECURRENCIAS] Iniciando evaluación segura de mantenimientos recurrentes...");

  try {
    const hoyLogico = normalizarFechaLogica(new Date());

    // 1. Buscar reglas activas vencidas hasta hoy. No se materializan ciclos futuros del mes.
    const reglasActivas = await prisma.reglaRecurrencia.findMany({
      where: {
        activo: true,
        proximaFechaEjecucion: { lte: hoyLogico },
        maquina: {
          estado: { notIn: ["BAJA", "BAJA", "DESUSO", "INACTIVA"] },
        },
      },
      include: {
        maquina: { select: { id: true, planta: true, area: true, estado: true } }
      }
    });

    console.log(`[CRON RECURRENCIAS] Se encontraron ${reglasActivas.length} reglas activas vencidas.`);

    if (reglasActivas.length === 0) {
      console.log("[CRON RECURRENCIAS] No hay reglas vencidas.");
      return;
    }

    // 2. Obtener un creadorId por defecto (el primer SUPER_ADMIN activo)
    const admin = await prisma.usuario.findFirst({
      where: { rol: Rol.SUPER_ADMIN, estado: "ACTIVO" },
      select: { id: true }
    });
    const creadorId = admin?.id ?? 1; // Fallback al ID 1 si no hay admin disponible

    let creados = 0;
    let omitidos = 0;
    let saltados = 0;
    let errores = 0;

    // 3. Procesar máximo un ciclo vigente por regla.
    for (const regla of reglasActivas) {
      try {
        const decision = resolverPoliticaMaterializacionRecurrencia(regla, hoyLogico);

        if (!decision.fechaCicloLogica) {
          if (decision.requiereActualizarCursor) {
            await prisma.reglaRecurrencia.update({
              where: { id: regla.id },
              data: { proximaFechaEjecucion: decision.proximaFechaEjecucion }
            });
          }
          console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ${decision.motivo}. descartados=${decision.ciclosDescartados}; próxima=${decision.proximaFechaEjecucion.toISOString().split("T")[0]}.`);
          saltados++;
          continue;
        }

        const fechaCiclo = decision.fechaCicloLogica;
        const ocurrencia = await resolverOcurrenciaConAjuste(regla.id, fechaCiclo);

        if (ocurrencia.omitida) {
          console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ocurrencia ${fechaCiclo.toISOString().split("T")[0]} omitida por ajuste operativo. descartados=${decision.ciclosDescartados}.`);
          omitidos++;
          await prisma.reglaRecurrencia.update({
            where: { id: regla.id },
            data: { proximaFechaEjecucion: decision.proximaFechaEjecucion }
          });
          continue;
        }

        const fechaEfectiva = normalizarFechaLogica(ocurrencia.fechaProgramadaPreventiva ?? fechaCiclo);
        if (fechaEfectiva > hoyLogico) {
          console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ciclo ${fechaCiclo.toISOString().split("T")[0]} movido a futuro (${fechaEfectiva.toISOString().split("T")[0]}), no se materializa aún.`);
          saltados++;
          continue;
        }

        const ticketExistente = await prisma.tarea.findFirst({
          where: {
            reglaRecurrenciaId: regla.id,
            fechaCicloLogica: fechaCiclo
          },
          select: { id: true }
        });

        if (ticketExistente) {
          console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ya existía ciclo ${fechaCiclo.toISOString().split("T")[0]} (ID: ${ticketExistente.id}). descartados=${decision.ciclosDescartados}.`);
          omitidos++;
        } else {
          const ticket = await materializarCicloInterno({
            regla,
            fechaCicloLogica: fechaCiclo,
            fechaProgramadaPreventiva: ocurrencia.fechaProgramadaPreventiva,
            maquinaPlanta: regla.maquina.planta,
            maquinaArea: regla.maquina.area,
            creadorId
          });

          if (ticket) {
            console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ciclo ${fechaCiclo.toISOString().split("T")[0]} creado (ID: ${ticket.id}). descartados=${decision.ciclosDescartados}.`);
            creados++;
          } else {
            console.warn(`[CRON RECURRENCIAS] Regla ID ${regla.id}: no se pudo crear ciclo ${fechaCiclo.toISOString().split("T")[0]}.`);
            errores++;
          }
        }

        await prisma.reglaRecurrencia.update({
          where: { id: regla.id },
          data: { proximaFechaEjecucion: decision.proximaFechaEjecucion }
        });

      } catch (ruleError) {
        console.error(`[CRON RECURRENCIAS ERROR] Falló el procesamiento de la regla ID ${regla.id}:`, ruleError);
        errores++;
      }
    }

    console.log(`[CRON RECURRENCIAS] Finalizado. Creados: ${creados} | Ya existían/omitidos: ${omitidos} | Sin ciclo vigente: ${saltados} | Errores: ${errores}`);
  } catch (error) {
    console.error("[CRON RECURRENCIAS FATAL ERROR] Error en la rutina de recurrencias:", error);
  }
}
