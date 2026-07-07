// src/modules/recurrencias/01_list.ts
// GET /api/maquinas/:id/recurrencias
import type { Request, Response } from "express";
import { prisma } from "../../db";

const REGLA_SELECT = {
  id: true,
  maquinaId: true,
  titulo: true,
  descripcion: true,
  categoria: true,
  prioridad: true,
  tiempoEstimado: true,
  frecuencia: true,
  intervaloDias: true,
  tecnicoResponsableId: true,
  proximaFechaEjecucion: true,
  activo: true,
  createdAt: true,
  updatedAt: true,
  maquina: {
    select: { id: true, codigo: true, nombre: true, planta: true, area: true },
  },
  tecnicoResponsable: {
    select: { id: true, nombre: true, username: true, email: true },
  },
} as const;

/** GET /api/maquinas/:id/recurrencias — Lista todas las reglas de una máquina */
export const listarReglasPorMaquina = async (req: Request, res: Response) => {
  try {
    const maquinaId = Number(req.params.id);

    const maquina = await prisma.maquina.findUnique({ where: { id: maquinaId }, select: { id: true } });
    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    const reglas = await prisma.reglaRecurrencia.findMany({
      where: { maquinaId },
      select: REGLA_SELECT,
      orderBy: [{ activo: "desc" }, { proximaFechaEjecucion: "asc" }],
    });

    return res.json({ data: reglas, total: reglas.length });
  } catch (error) {
    console.error("[recurrencias] listarReglasPorMaquina error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

/** GET /api/recurrencias/:id — Obtiene una regla por ID */
export const getReglaById = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const regla = await prisma.reglaRecurrencia.findUnique({
      where: { id },
      select: REGLA_SELECT,
    });
    if (!regla) return res.status(404).json({ error: "Regla de recurrencia no encontrada" });
    return res.json(regla);
  } catch (error) {
    console.error("[recurrencias] getReglaById error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
