import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import { normalizarFechaLogica, ZONA_HORARIA_MX } from "../../utils/recurrencia-temporal";
import { materializarActividadEnTransaccion } from "./materialize-core";
import { resolverPoliticaMaterializacionActividad } from "./materialization-policy";
import { notificarAsignacionTrasCommit } from "./06_materialize";
import { reglaActividadInclude } from "./types";
import { ejecutarNotificacionEnSegundoPlano } from "../notificaciones/services";

export async function procesarActividadesRecurrentesProgramadas() {
  const hoy = normalizarFechaLogica(
    new Date().toLocaleDateString("en-CA", { timeZone: ZONA_HORARIA_MX })
  );

  console.log(`[ACTIVIDADES RECURRENTES] Procesando pendientes para fecha lógica: ${hoy.toISOString().split("T")[0]}...`);

  const reglas = await prisma.reglaActividadRecurrente.findMany({
    where: {
      activo: true,
      archivadoAt: null,
      proximaFechaEjecucion: { lte: hoy },
    },
    include: reglaActividadInclude,
  });

  let procesadas = 0;
  let creadas = 0;
  let existentes = 0;
  let omitidas = 0;
  let errores = 0;

  for (const reglaInicial of reglas) {
    procesadas++;
    try {
      const notifsToDispatch: Array<{ tarea: any; responsablesIds: number[] }> = [];

      await prisma.$transaction(async (tx) => {
        const reglaFresca = await tx.reglaActividadRecurrente.findUnique({
          where: { id: reglaInicial.id },
          include: reglaActividadInclude,
        });

        if (!reglaFresca || !reglaFresca.activo || reglaFresca.archivadoAt) {
          return;
        }

        const decision = resolverPoliticaMaterializacionActividad(reglaFresca, hoy);

        if (!decision.fechaCicloLogica) {
          if (decision.requiereActualizarCursor) {
            await tx.reglaActividadRecurrente.update({
              where: { id: reglaFresca.id },
              data: { proximaFechaEjecucion: decision.proximaFechaEjecucion },
            });
          }
          console.log(`[ACTIVIDADES RECURRENTES] Regla ${reglaFresca.id} | ${decision.motivo} | descartados=${decision.ciclosDescartados} | próxima=${decision.proximaFechaEjecucion.toISOString().split("T")[0]}`);
          return;
        }

        const fechaCiclo = decision.fechaCicloLogica;
        const reglaParaMaterializar = {
          ...reglaFresca,
          proximaFechaEjecucion: fechaCiclo,
        };
        const resMat = await materializarActividadEnTransaccion({
          tx,
          regla: reglaParaMaterializar,
          fechaCicloLogica: fechaCiclo,
          creadorId: reglaFresca.creadorId,
        });

        if (resMat.omitida) {
          omitidas++;
          console.log(`[ACTIVIDADES RECURRENTES] Regla ${reglaFresca.id} | ciclo ${fechaCiclo.toISOString().split("T")[0]} | omitida | descartados=${decision.ciclosDescartados}`);
        } else if (resMat.yaExistia) {
          existentes++;
          console.log(`[ACTIVIDADES RECURRENTES] Regla ${reglaFresca.id} | ciclo ${fechaCiclo.toISOString().split("T")[0]} | tarea existente | descartados=${decision.ciclosDescartados}`);
        } else if (resMat.tarea) {
          creadas++;
          console.log(`[ACTIVIDADES RECURRENTES] Regla ${reglaFresca.id} | ciclo ${fechaCiclo.toISOString().split("T")[0]} | tarea ${resMat.tarea.id} creada | descartados=${decision.ciclosDescartados}`);
          if (resMat.responsablesIds.length > 0) {
            notifsToDispatch.push({ tarea: resMat.tarea, responsablesIds: resMat.responsablesIds });
          }
        }
      });

      for (const n of notifsToDispatch) {
        ejecutarNotificacionEnSegundoPlano(
          "NOTIF_ASYNC_ACTIVIDAD_RECURRENTE_MATERIALIZADA",
          notificarAsignacionTrasCommit(n.tarea, n.responsablesIds)
        );
      }
    } catch (err) {
      errores++;
      console.error(`[ACTIVIDADES RECURRENTES ERROR] Regla ${reglaInicial.id} fallo al materializar:`, err);
    }
  }

  const resumen = `procesadas=${procesadas} | creadas=${creadas} | existentes=${existentes} | omitidas=${omitidas} | errores=${errores}`;
  console.log(`[ACTIVIDADES RECURRENTES] Finalizado | ${resumen}`);

  if (creadas > 0 || omitidas > 0) {
    await registrarAccion("PROCESAR_ACTIVIDADES_RECURRENTES", 1, `Auto-materialización: ${resumen}`);
  }

  return { habilitado: true, procesadas, creadas, existentes, omitidas, errores };
}

