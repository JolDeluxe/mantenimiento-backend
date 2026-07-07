// src/modules/recurrencias/automations.ts
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { normalizarFechaLogica, calcularSiguienteFechaLogica } from "./helper";
import { materializarCicloInterno } from "./02_create";

/**
 * Evalúa las reglas de recurrencia activas y materializa un ciclo por regla
 * si corresponde (proximaFechaEjecucion <= hoy normalizado).
 * 
 * COMPORTAMIENTO PARA REGLAS ATRASADAS:
 * - Se procesa solo UN ciclo por ejecución del cron para cada regla.
 * - Se avanza 'proximaFechaEjecucion' al siguiente ciclo lógico.
 * - Si tras avanzar la fecha sigue vencida (muy atrasada), se procesará en la
 *   siguiente ejecución del cron (ej. al día siguiente), evitando generar
 *   múltiples tickets históricos de golpe.
 */
export async function procesarRecurrenciasProgramadas() {
  console.log("[CRON RECURRENCIAS] Iniciando evaluación de mantenimientos recurrentes...");

  try {
    const hoyLogico = normalizarFechaLogica(new Date());

    // 1. Buscar reglas activas y vencidas
    const reglasVencidas = await prisma.reglaRecurrencia.findMany({
      where: {
        activo: true,
        proximaFechaEjecucion: { lte: hoyLogico }
      },
      include: {
        maquina: { select: { id: true, planta: true, area: true, estado: true } }
      }
    });

    console.log(`[CRON RECURRENCIAS] Se encontraron ${reglasVencidas.length} reglas activas vencidas para procesar.`);

    if (reglasVencidas.length === 0) {
      console.log("[CRON RECURRENCIAS] No hay reglas vencidas en esta ejecución.");
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
    let errores = 0;

    // 3. Procesar una por una de forma segura
    for (const regla of reglasVencidas) {
      try {
        // Ignorar reglas de máquinas dadas de baja
        if (regla.maquina.estado === "BAJA" || regla.maquina.estado === "BAJA_ERP") {
          console.warn(`[CRON RECURRENCIAS] Omitiendo regla ID ${regla.id} ("${regla.titulo}"): la máquina ID ${regla.maquinaId} está de baja.`);
          continue;
        }

        const fechaCiclo = normalizarFechaLogica(regla.proximaFechaEjecucion);

        // Verificar si ya existe ticket (idempotencia)
        const ticketExistente = await prisma.tarea.findFirst({
          where: {
            reglaRecurrenciaId: regla.id,
            fechaCicloLogica: fechaCiclo
          },
          select: { id: true }
        });

        if (ticketExistente) {
          console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: Ticket ya existía para el ciclo ${fechaCiclo.toISOString().split('T')[0]} (ID: ${ticketExistente.id}).`);
          omitidos++;
        } else {
          // Materializar el ticket
          const ticket = await materializarCicloInterno({
            regla,
            fechaCicloLogica: fechaCiclo,
            maquinaPlanta: regla.maquina.planta,
            maquinaArea: regla.maquina.area,
            creadorId
          });
          
          if (ticket) {
            console.log(`[CRON RECURRENCIAS] Regla ID ${regla.id}: Ticket materializado exitosamente (ID: ${ticket.id}).`);
            creados++;
          } else {
            console.warn(`[CRON RECURRENCIAS] Regla ID ${regla.id}: No se pudo materializar el ticket.`);
            errores++;
          }
        }

        // Avanzar la proximaFechaEjecucion al siguiente ciclo lógico (evitando drift)
        const siguienteFecha = calcularSiguienteFechaLogica(
          fechaCiclo,
          regla.frecuencia,
          regla.intervaloDias
        );

        await prisma.reglaRecurrencia.update({
          where: { id: regla.id },
          data: { proximaFechaEjecucion: siguienteFecha }
        });

      } catch (ruleError) {
        console.error(`[CRON RECURRENCIAS ERROR] Falló el procesamiento de la regla ID ${regla.id}:`, ruleError);
        errores++;
      }
    }

    console.log(`[CRON RECURRENCIAS] Finalizado. Creados: ${creados} | Ya existían (omitidos): ${omitidos} | Errores: ${errores}`);
  } catch (error) {
    console.error("[CRON RECURRENCIAS FATAL ERROR] Error en la rutina de recurrencias:", error);
  }
}
