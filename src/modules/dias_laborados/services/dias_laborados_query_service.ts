import { prisma } from "../../../db";
import { EstadoTarea } from "@prisma/client";
import type { IntervaloTrabajo } from "../types";
import type { TareaPlanificable, PreventivoRecurrente } from "../calculations/planificacion";

export class DiasLaboradosQueryService {
  /**
   * Obtiene todos los intervalos de tiempo en el rango solicitado (excluyendo autónomos).
   * Solo intervalos con estado EN_PROGRESO son válidos para el cálculo de tiempo real.
   */
  static async obtenerIntervalos(desde: Date, hastaExclusivo: Date): Promise<IntervaloTrabajo[]> {
    return prisma.intervaloTiempo.findMany({
      where: {
        inicio: { lt: hastaExclusivo },
        OR: [
          { fin: null },
          { fin: { gt: desde } }
        ],
        tarea: {
          clasificacion: { not: "AUTONOMO" }
        }
      },
      select: {
        id: true,
        usuarioId: true,
        estado: true,
        inicio: true,
        fin: true,
        tarea: {
          select: {
            tipo: true,
            clasificacion: true,
            maquinaId: true,
          }
        }
      }
    }) as unknown as Promise<IntervaloTrabajo[]>;
  }

  /**
   * Obtiene todas las tareas planificadas activas en el rango (excluyendo canceladas).
   * Usa fechas programadas reales; no usa createdAt como sustituto de planificación.
   */
  static async obtenerTareasPlanificadas(desde: Date, hastaExclusivo: Date): Promise<TareaPlanificable[]> {
    const tareas = await prisma.tarea.findMany({
      where: {
        estado: { not: EstadoTarea.CANCELADA },
        OR: [
          {
            horaInicioProgramada: { lt: hastaExclusivo },
            horaFinProgramada: { gt: desde }
          },
          {
            fechaProgramadaPreventiva: {
              gte: desde,
              lt: hastaExclusivo
            }
          },
          {
            fechaCicloLogica: {
              gte: desde,
              lt: hastaExclusivo
            }
          },
          {
            fechaVencimiento: {
              gte: desde,
              lt: hastaExclusivo
            },
          }
        ]
      },
      select: {
        id: true,
        estado: true,
        horaInicioProgramada: true,
        horaFinProgramada: true,
        fechaProgramadaPreventiva: true,
        fechaCicloLogica: true,
        fechaVencimiento: true,
        tiempoEstimado: true
      }
    });

    return tareas as TareaPlanificable[];
  }

  /**
   * Obtiene preventivos recurrentes vigentes para proyectar tiempo programado futuro.
   * Usa la relación ReglaRecurrencia -> tareas (tickets generados) para obtener el último
   * ciclo ejecutado y calcular la próxima aparición.
   */
  static async obtenerFuentesRecurrentes(): Promise<PreventivoRecurrente[]> {
    const recurrencias = await prisma.reglaRecurrencia.findMany({
      where: {
        activo: true,
      },
      select: {
        id: true,
        frecuencia: true,
        intervaloDias: true,
        tiempoEstimado: true,
        proximaFechaEjecucion: true,
        tareas: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            createdAt: true,
          }
        }
      }
    });

    const frequencyMapping: Record<string, number> = {
      DIARIO: 1,
      SEMANAL: 7,
      MENSUAL: 30,
      BIMESTRAL: 60,
      TRIMESTRAL: 90,
      SEMESTRAL: 180,
      ANUAL: 365,
      PERSONALIZADA_DIAS: 0, // se resolverá con intervaloDias
    };

    return recurrencias.map((r) => {
      const freqStr = String(r.frecuencia).toUpperCase();
      let dias = frequencyMapping[freqStr] ?? 7;
      if (freqStr === "PERSONALIZADA_DIAS" && r.intervaloDias) {
        dias = r.intervaloDias;
      }
      const ultimoMant = r.tareas[0]?.createdAt || null;

      return {
        id: r.id,
        frecuenciaDias: dias > 0 ? dias : 7,
        ultimoMantenimiento: ultimoMant,
        tiempoEstimadoMinutos: r.tiempoEstimado ?? 60,
      };
    });
  }
}
