import type { Request, Response } from "express";
import { prisma } from "../../db";
import { formatearFechaLogica, generarCiclosEnRango, normalizarFechaLogica } from "../../utils/recurrencia-temporal";
import { resolverAjuste } from "./helper";
import { reglaActividadInclude, type ProyeccionActividad, type ReglaActividadConRelaciones } from "./types";

const hoyMX = () => normalizarFechaLogica(new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }));

function rango(req: Request) {
  const query = req.query as unknown as { from?: string; to?: string };
  const from = query.from ? normalizarFechaLogica(query.from) : hoyMX();
  const to = query.to ? normalizarFechaLogica(query.to) : new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 90));
  if (to < from) throw new Error("El rango de proyección es inválido");
  if ((to.getTime() - from.getTime()) / 86400000 > 366) throw new Error("El rango máximo de proyección es de 366 días");
  return { from, to };
}

async function proyectar(reglas: ReglaActividadConRelaciones[], from: Date, to: Date): Promise<ProyeccionActividad[]> {
  const ids = reglas.map((regla) => regla.id);
  if (ids.length === 0) return [];
  const [tareas, ajustes] = await Promise.all([
    prisma.tarea.findMany({ where: { reglaActividadRecurrenteId: { in: ids }, fechaCicloLogica: { gte: from, lte: to } }, select: { id: true, reglaActividadRecurrenteId: true, fechaCicloLogica: true, estado: true } }),
    prisma.reglaActividadRecurrenteAjuste.findMany({ where: { reglaActividadRecurrenteId: { in: ids }, fechaOriginal: { gte: from, lte: to }, activo: true } }),
  ]);
  const tasks = new Map(tareas.filter((tarea) => tarea.fechaCicloLogica).map((tarea) => [`${tarea.reglaActividadRecurrenteId}|${tarea.fechaCicloLogica!.toISOString()}`, tarea]));
  const ajustesMap = new Map(ajustes.map((ajuste) => [`${ajuste.reglaActividadRecurrenteId}|${ajuste.fechaOriginal.toISOString()}`, ajuste]));

  return reglas.flatMap((regla) => generarCiclosEnRango(regla, from, to).map((cycle) => {
    const key = `${regla.id}|${cycle.toISOString()}`;
    const ajuste = ajustesMap.get(key) ?? null;
    const resolved = resolverAjuste(cycle, ajuste);
    const task = tasks.get(key) ?? null;
    return {
      reglaId: regla.id,
      fechaCicloLogica: formatearFechaLogica(cycle),
      fechaOriginal: formatearFechaLogica(resolved.fechaOriginal),
      fechaProgramada: formatearFechaLogica(resolved.fechaProgramada),
      ajusteTipo: resolved.tipo,
      motivo: resolved.motivo,
      omitida: resolved.omitida,
      movida: resolved.movida,
      pendienteMaterializar: !resolved.omitida && !task,
      tareaId: task?.id ?? null,
      tareaEstado: task?.estado ?? null,
    };
  })).sort((a, b) => a.fechaCicloLogica.localeCompare(b.fechaCicloLogica));
}

export async function obtenerProyeccionesActividad(req: Request, res: Response) {
  try {
    const query = req.query as unknown as { reglaId?: number; incluirInactivas: boolean };
    const period = rango(req);
    const reglas = await prisma.reglaActividadRecurrente.findMany({
      where: { archivadoAt: null, ...(query.incluirInactivas ? {} : { activo: true }), ...(query.reglaId ? { id: query.reglaId } : {}) },
      include: reglaActividadInclude,
    });
    return res.json({ success: true, from: formatearFechaLogica(period.from), to: formatearFechaLogica(period.to), data: await proyectar(reglas, period.from, period.to) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno al proyectar actividades recurrentes";
    return res.status(message.startsWith("El rango") ? 400 : 500).json({ error: message });
  }
}

export async function obtenerProyeccionesReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const period = rango(req);
    const regla = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, include: reglaActividadInclude });
    if (!regla) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    return res.json({ success: true, reglaId: id, from: formatearFechaLogica(period.from), to: formatearFechaLogica(period.to), data: await proyectar([regla], period.from, period.to) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno al proyectar la actividad recurrente";
    return res.status(message.startsWith("El rango") ? 400 : 500).json({ error: message });
  }
}
