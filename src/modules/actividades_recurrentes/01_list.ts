import type { Request, Response } from "express";
import { Prisma, UnidadRecurrenciaActividad } from "@prisma/client";
import { prisma } from "../../db";
import { dtoReglaActividad } from "./helper";
import { reglaActividadInclude } from "./types";

export async function listarReglasActividad(req: Request, res: Response) {
  try {
    const query = req.query as unknown as {
      q?: string; page: number; limit: number; activo?: boolean; incluirArchivadas: boolean;
      categoria?: string; planta?: string; area?: string; responsableId?: number; unidad?: UnidadRecurrenciaActividad;
    };
    const where: Prisma.ReglaActividadRecurrenteWhereInput = {
      ...(query.incluirArchivadas ? {} : { archivadoAt: null }),
      ...(query.activo === undefined ? {} : { activo: query.activo }),
      ...(query.categoria ? { categoria: query.categoria } : {}),
      ...(query.planta ? { planta: query.planta } : {}),
      ...(query.area ? { area: query.area } : {}),
      ...(query.responsableId ? { responsables: { some: { id: query.responsableId } } } : {}),
      ...(query.unidad ? { unidad: query.unidad } : {}),
      ...(query.q ? {
        OR: [
          { titulo: { contains: query.q } },
          { descripcion: { contains: query.q } },
          { categoria: { contains: query.q } },
          { area: { contains: query.q } },
        ],
      } : {}),
    };
    const skip = (query.page - 1) * query.limit;
    const [reglas, total] = await prisma.$transaction([
      prisma.reglaActividadRecurrente.findMany({ where, include: reglaActividadInclude, orderBy: [{ archivadoAt: "asc" }, { proximaFechaEjecucion: "asc" }], skip, take: query.limit }),
      prisma.reglaActividadRecurrente.count({ where }),
    ]);
    return res.json({ success: true, pagination: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }, data: reglas.map(dtoReglaActividad) });
  } catch (error) {
    console.error("[actividades-recurrentes] listarReglasActividad error:", error);
    return res.status(500).json({ error: "Error interno al obtener actividades recurrentes" });
  }
}

export async function obtenerReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const regla = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, include: reglaActividadInclude });
    if (!regla) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    return res.json({ success: true, data: dtoReglaActividad(regla) });
  } catch (error) {
    console.error("[actividades-recurrentes] obtenerReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al obtener la actividad recurrente" });
  }
}
