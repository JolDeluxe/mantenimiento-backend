// src/modules/recurrencias/automations.ts
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { normalizarFechaLogica, calcularSiguienteFechaLogica, inicioMesUTC, finDeMesUTC } from "./helper";
import { materializarCicloInterno } from "./02_create";
import { resolverOcurrenciaConAjuste } from "./ajustes-helper";

/**
 * Evalúa reglas activas y materializa ciclos del mes actual.
 * 
 * COMPORTAMIENTO PARA REGLAS ATRASADAS:
 * - No espera al día exacto: genera ciclos programados dentro del mes actual.
 * - Idempotente por (reglaRecurrenciaId + fechaCicloLogica).
 * - Avanza proximaFechaEjecucion al primer ciclo posterior al mes actual.
 */
export async function procesarRecurrenciasProgramadas() {
  console.log("[CRON RECURRENCIAS] Iniciando evaluación mensual de mantenimientos recurrentes...");

  try {
    const hoyLogico = normalizarFechaLogica(new Date());
    const inicioMes = inicioMesUTC(hoyLogico);
    const finMes = finDeMesUTC(hoyLogico);

    // 1. Buscar reglas activas con algún ciclo posible hasta el cierre del mes actual.
    const reglasActivas = await prisma.reglaRecurrencia.findMany({
      where: {
        activo: true,
        proximaFechaEjecucion: { lte: finMes },
        maquina: {
          estado: { notIn: ["BAJA", "BAJA", "DESUSO", "INACTIVA"] },
        },
      },
      include: {
        maquina: { select: { id: true, planta: true, area: true, estado: true } }
      }
    });

    console.log(`[CRON RECURRENCIAS] Se encontraron ${reglasActivas.length} reglas activas aplicables al mes.`);

    if (reglasActivas.length === 0) {
      console.log("[CRON RECURRENCIAS] No hay reglas aplicables al mes actual.");
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

    // 3. Procesar ciclos del mes por regla.
    for (const regla of reglasActivas) {
      try {
        let cursor = normalizarFechaLogica(regla.proximaFechaEjecucion);
        let avanzoCursor = false;

        while (cursor < inicioMes) {
          cursor = calcularSiguienteFechaLogica(cursor, regla.frecuencia, regla.intervaloDias);
          avanzoCursor = true;
        }

        let ciclosMes = 0;
        while (cursor <= finMes) {
          const fechaCiclo = normalizarFechaLogica(cursor);
          ciclosMes++;
          const ocurrencia = await resolverOcurrenciaConAjuste(regla.id, fechaCiclo);

          if (ocurrencia.omitida) {
            console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ocurrencia ${fechaCiclo.toISOString().split("T")[0]} omitida por ajuste operativo.`);
            omitidos++;
            cursor = calcularSiguienteFechaLogica(fechaCiclo, regla.frecuencia, regla.intervaloDias);
            avanzoCursor = true;
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
            console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ya existía ciclo ${fechaCiclo.toISOString().split("T")[0]} (ID: ${ticketExistente.id}).`);
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
              console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: ciclo ${fechaCiclo.toISOString().split("T")[0]} creado (ID: ${ticket.id}).`);
              creados++;
            } else {
              console.warn(`[CRON RECURRENCIAS] Regla ID ${regla.id}: no se pudo crear ciclo ${fechaCiclo.toISOString().split("T")[0]}.`);
              errores++;
            }
          }

          cursor = calcularSiguienteFechaLogica(fechaCiclo, regla.frecuencia, regla.intervaloDias);
          avanzoCursor = true;
        }

        if (ciclosMes === 0) saltados++;

        if (avanzoCursor) {
          await prisma.reglaRecurrencia.update({
            where: { id: regla.id },
            data: { proximaFechaEjecucion: cursor }
          });
        }

      } catch (ruleError) {
        console.error(`[CRON RECURRENCIAS ERROR] Falló el procesamiento de la regla ID ${regla.id}:`, ruleError);
        errores++;
      }
    }

    console.log(`[CRON RECURRENCIAS] Finalizado. Creados: ${creados} | Ya existían: ${omitidos} | Sin ciclo este mes: ${saltados} | Errores: ${errores}`);
  } catch (error) {
    console.error("[CRON RECURRENCIAS FATAL ERROR] Error en la rutina de recurrencias:", error);
  }
}
