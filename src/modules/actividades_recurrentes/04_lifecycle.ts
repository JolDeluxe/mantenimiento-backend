import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import { dtoReglaActividad } from "./helper";
import { reglaActividadInclude } from "./types";

export async function cambiarActivoReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const activo = req.body.activo as boolean;
    const actual = await prisma.reglaActividadRecurrente.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    if (actual.archivadoAt) return res.status(400).json({ error: "Una actividad archivada debe restaurarse antes de cambiar su estado" });
    const regla = await prisma.reglaActividadRecurrente.update({ where: { id }, data: { activo }, include: reglaActividadInclude });
    await registrarAccion("CAMBIAR_ESTADO_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} activo=${activo}`);
    return res.json({ success: true, data: dtoReglaActividad(regla) });
  } catch (error) {
    console.error("[actividades-recurrentes] cambiarActivoReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al cambiar el estado de la actividad recurrente" });
  }
}

export async function archivarReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const actual = await prisma.reglaActividadRecurrente.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    const regla = await prisma.reglaActividadRecurrente.update({ where: { id }, data: { activo: false, archivadoAt: new Date() }, include: reglaActividadInclude });
    await registrarAccion("ARCHIVAR_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} archivada`);
    return res.json({ success: true, data: dtoReglaActividad(regla) });
  } catch (error) {
    console.error("[actividades-recurrentes] archivarReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al archivar la actividad recurrente" });
  }
}

export async function restaurarReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const actual = await prisma.reglaActividadRecurrente.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    const regla = await prisma.reglaActividadRecurrente.update({ where: { id }, data: { activo: false, archivadoAt: null }, include: reglaActividadInclude });
    await registrarAccion("RESTAURAR_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} restaurada en pausa`);
    return res.json({ success: true, data: dtoReglaActividad(regla), mensaje: "La regla fue restaurada y permanece pausada hasta activarla explícitamente" });
  } catch (error) {
    console.error("[actividades-recurrentes] restaurarReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al restaurar la actividad recurrente" });
  }
}

export async function eliminarReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const actual = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, select: { id: true } });
    if (!actual) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    const [tareas, ajustes] = await Promise.all([
      prisma.tarea.count({ where: { reglaActividadRecurrenteId: id } }),
      prisma.reglaActividadRecurrenteAjuste.count({ where: { reglaActividadRecurrenteId: id } }),
    ]);
    if (tareas > 0 || ajustes > 0) {
      return res.status(409).json({ error: "La regla tiene tareas o ajustes; debe archivarse en lugar de eliminarse" });
    }
    await prisma.reglaActividadRecurrente.delete({ where: { id } });
    await registrarAccion("ELIMINAR_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} eliminada físicamente sin tareas ni ajustes`);
    return res.status(204).send();
  } catch (error) {
    console.error("[actividades-recurrentes] eliminarReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al eliminar la actividad recurrente" });
  }
}
