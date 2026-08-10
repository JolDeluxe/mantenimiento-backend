import { prisma } from "../../db";

const PLANTAS_EXCLUIDAS = new Set(["BAJA", "GENERAL", "INACTIVA", "CERRADA"]);

export const getPlantasOperativas = async (): Promise<string[]> => {
  const distinctResult = await prisma.maquina.findMany({
    select: { planta: true },
    distinct: ["planta"]
  });

  return distinctResult
    .map(m => m.planta?.trim().toUpperCase())
    .filter((p): p is string => typeof p === 'string' && !PLANTAS_EXCLUIDAS.has(p))
    .sort();
};

export const getMaquinasDistinctValues = async () => {
  const [distinctPlantas, distinctAreas, distinctProcesos] = await Promise.all([
    getPlantasOperativas(),
    prisma.maquina.findMany({ select: { area: true }, distinct: ["area"] }),
    prisma.maquina.findMany({ select: { proceso: true }, distinct: ["proceso"] })
  ]);

  return {
    plantas: Array.isArray(distinctPlantas) ? distinctPlantas : [],
    areas: distinctAreas.map(m => m.area).filter(Boolean).sort(),
    procesos: distinctProcesos.map(m => m.proceso).filter(Boolean).sort()
  };
};

import { EstadoTarea } from "@prisma/client";

export const recalcularEstadoMaquina = async (
  maquinaId: number,
  tx?: any,
  transitionCtx?: {
    tareaId?: number;
    nuevoEstado?: EstadoTarea;
    paroProduccion?: boolean;
    maquinaOperativaAlResolver?: boolean;
  }
): Promise<string | null> => {
  const client = tx || prisma;

  const maquina = await client.maquina.findUnique({
    where: { id: maquinaId },
    select: { estado: true }
  });

  if (!maquina || maquina.estado === "BAJA" || maquina.estado === "INACTIVA") {
    return maquina?.estado || null;
  }

  // 1. Paro productivo activo:
  // - Alguna tarea activa (no RESUELTO, CERRADO, CANCELADA) con paroProduccion = true
  // - O algún IntervaloParoMaquina abierto (fin = null)
  // - O la tarea actual si sigue activa o si se resolvió pero no quedó operativa
  const activeParoTareas = await client.tarea.count({
    where: {
      maquinaId,
      paroProduccion: true,
      estado: {
        notIn: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA]
      },
      NOT: transitionCtx?.tareaId ? { id: transitionCtx.tareaId } : undefined
    }
  });

  const countParosIntervalos = await client.intervaloParoMaquina.count({
    where: {
      maquinaId,
      fin: null
    }
  });

  let tieneParoActivo = activeParoTareas > 0 || countParosIntervalos > 0;

  if (transitionCtx && transitionCtx.tareaId) {
    const isCurrentTaskParo = transitionCtx.paroProduccion;
    const isCurrentTaskActive = !( [EstadoTarea.RESUELTO, EstadoTarea.CERRADO, EstadoTarea.CANCELADA] as EstadoTarea[] ).includes(transitionCtx.nuevoEstado!);
    if (isCurrentTaskParo && isCurrentTaskActive) {
      tieneParoActivo = true;
    }
    if (isCurrentTaskParo && transitionCtx.nuevoEstado === EstadoTarea.RESUELTO && transitionCtx.maquinaOperativaAlResolver !== true) {
      tieneParoActivo = true;
    }
  }

  if (tieneParoActivo) {
    const res = await client.maquina.update({
      where: { id: maquinaId },
      data: { estado: "PARO_PRODUCCION" }
    });
    return res.estado;
  }

  // 2. Trabajo correctivo activo / Reparación activa:
  // - Alguna tarea correctiva activa en EN_PROGRESO o EN_PAUSA
  const activeTasksCount = await client.tarea.count({
    where: {
      maquinaId,
      clasificacion: "CORRECTIVO",
      estado: {
        in: [EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA]
      },
      NOT: transitionCtx?.tareaId ? { id: transitionCtx.tareaId } : undefined
    }
  });

  let tieneTrabajoActivo = activeTasksCount > 0;
  if (transitionCtx && transitionCtx.tareaId) {
    const isCurrentRepair = ([EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA] as EstadoTarea[]).includes(transitionCtx.nuevoEstado!);
    if (isCurrentRepair) {
      tieneTrabajoActivo = true;
    }
  }

  if (tieneTrabajoActivo) {
    const res = await client.maquina.update({
      where: { id: maquinaId },
      data: { estado: "EN_REPARACION" }
    });
    return res.estado;
  }

  // 3. Sin actividad activa:
  const res = await client.maquina.update({
    where: { id: maquinaId },
    data: { estado: "OPERATIVA" }
  });
  return res.estado;
};

