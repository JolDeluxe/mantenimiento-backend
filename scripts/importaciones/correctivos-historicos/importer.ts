import { prisma } from "../../../src/db";
import {
  TipoTarea,
  ClasificacionTarea,
  EstadoTarea,
  CalidadDato,
  ImpactoProduccionConfirmado,
  EstadoFalla,
} from "@prisma/client";
import type { ResolvedHistoricalRecord } from "./types";

export interface ImportResultSingle {
  rowNumber: number;
  success: boolean;
  tareaId?: number;
  fallaId?: number;
  intervaloTiempoId?: number;
  error?: string;
}

/**
 * Importa un registro histórico resuelto en una única transacción atómica de Prisma.
 * Si ocurre cualquier fallo en Tarea, FallaMaquina o IntervaloTiempo,
 * se revierte completamente para este registro.
 */
export async function importSingleHistoricalRecord(
  record: ResolvedHistoricalRecord
): Promise<ImportResultSingle> {
  if (record.action !== "IMPORTAR" || !record.maquinaId || !record.clienteInternoId || !record.fechaInicio || !record.fechaFin || !record.duracionMinutos) {
    return {
      rowNumber: record.rowNumber,
      success: false,
      error: `El registro no está listo para importar (${record.errorCode || record.action}).`,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Obtener la máquina para extraer snapshots inalterables
      const maquina = await tx.maquina.findUnique({
        where: { id: record.maquinaId! },
      });

      if (!maquina) {
        throw new Error(`La máquina ID ${record.maquinaId} no existe.`);
      }

      // Construir la descripción histórica con trazabilidad completa y fingerprint
      const descripcion = [
        "Registro correctivo importado del histórico de mantenimiento.",
        "",
        `Equipo histórico: ${record.raw.equipo}`,
        `Departamento histórico: ${record.raw.departamento}`,
        `Línea histórica: ${record.raw.linea}`,
        `Fecha histórica: ${record.raw.columna1}`,
        `Inicio histórico: ${record.raw.horaInicio}`,
        `Fin histórico: ${record.raw.horaFin}`,
        `Tiempo de reparación: ${record.duracionMinutos} minutos`,
        "Técnico original: No identificado en la fuente histórica. Usuario técnico asociado únicamente como actor de importación.",
        `Origen: HIST_CORR_2025_2026`,
        `[IMPORT:${record.fingerprint}]`,
      ].join("\n");

      // 2. Crear Tarea histórica concluida
      const tarea = await tx.tarea.create({
        data: {
          tipo: TipoTarea.TICKET,
          clasificacion: ClasificacionTarea.CORRECTIVO,
          titulo: `Correctivo histórico — ${record.raw.linea || maquina.nombre}`,
          categoria: "MAQUINARIA",
          descripcion,
          prioridad: "MEDIA",
          planta: maquina.planta,
          area: maquina.area,
          estado: EstadoTarea.CERRADO,
          fechaInicio: record.fechaInicio!,
          finalizadoAt: record.fechaFin!,
          duracionReal: record.duracionMinutos!,
          maquinaId: maquina.id,
          paroProduccion: false, // NO se asume paro de producción
          creadorId: record.clienteInternoId!,
          departamentoId: maquina.departamentoId,
          createdAt: record.fechaInicio!,
          updatedAt: record.fechaFin!,
        },
      });

      // 3. Crear FallaMaquina histórica estimada (Calidad = HISTORICO_ESTIMADO, Impacto = SIN_PARO)
      const falla = await tx.fallaMaquina.create({
        data: {
          maquinaId: maquina.id,
          tareaId: tarea.id,
          estado: EstadoFalla.CERRADA,
          calidadDato: CalidadDato.HISTORICO_ESTIMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: record.fechaInicio!,
          fechaFallaConfirmada: record.fechaInicio!,
          fechaRestauracion: record.fechaFin!,
          confirmadoPorId: record.confirmadorId || null,
          snapshotCodigo: maquina.codigo,
          snapshotPlanta: maquina.planta,
          snapshotArea: maquina.area,
          snapshotProceso: maquina.proceso,
          snapshotCriticidad: maquina.criticidad,
          createdAt: record.fechaInicio!,
          updatedAt: record.fechaFin!,
        },
      });

      // 4. Crear IntervaloTiempo de trabajo técnico
      const intervalo = await tx.intervaloTiempo.create({
        data: {
          tareaId: tarea.id,
          usuarioId: record.tecnicoId || record.clienteInternoId!,
          estado: EstadoTarea.CERRADO,
          inicio: record.fechaInicio!,
          fin: record.fechaFin!,
          duracion: record.duracionMinutos!,
        },
      });

      // IMPORTANTE: NO se crea IntervaloParoMaquina por instrucción explícita del dominio.

      return {
        tareaId: tarea.id,
        fallaId: falla.id,
        intervaloTiempoId: intervalo.id,
      };
    });

    return {
      rowNumber: record.rowNumber,
      success: true,
      tareaId: result.tareaId,
      fallaId: result.fallaId,
      intervaloTiempoId: result.intervaloTiempoId,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      rowNumber: record.rowNumber,
      success: false,
      error: errMsg,
    };
  }
}
