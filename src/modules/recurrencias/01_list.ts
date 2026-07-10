// src/modules/recurrencias/01_list.ts
// GET /api/recurrencias
// GET /api/maquinas/:id/recurrencias
import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";

const ESTADOS_MAQUINA_OCULTOS = ["BAJA", "BAJA_ERP", "DESUSO", "INACTIVA"];

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
    select: { id: true, codigo: true, nombre: true, proceso: true, planta: true, area: true, estado: true },
  },
  tecnicoResponsable: {
    select: { id: true, nombre: true, username: true, email: true },
  },
} as const;

/** GET /api/recurrencias — Lista global de reglas recurrentes */
export const listarReglasGlobal = async (req: Request, res: Response) => {
  try {
    const {
      activo,
      q,
      maquinaId,
      tecnicoId,
      incluirBaja = false,
      page = 1,
      limit = 20,
    } = req.query as {
      activo?: boolean;
      q?: string;
      maquinaId?: number;
      tecnicoId?: number;
      incluirBaja?: boolean;
      page?: number;
      limit?: number;
    };

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (safePage - 1) * safeLimit;

    const where: Prisma.ReglaRecurrenciaWhereInput = {
      ...(activo !== undefined && { activo }),
      ...(maquinaId !== undefined && { maquinaId }),
      ...(tecnicoId !== undefined && { tecnicoResponsableId: tecnicoId }),
      ...(!incluirBaja && { maquina: { estado: { notIn: ESTADOS_MAQUINA_OCULTOS } } }),
      ...(q?.trim() && {
        OR: [
          { titulo: { contains: q.trim() } },
          { descripcion: { contains: q.trim() } },
          { maquina: { codigo: { contains: q.trim() } } },
          { maquina: { nombre: { contains: q.trim() } } },
          { tecnicoResponsable: { nombre: { contains: q.trim() } } },
        ],
      }),
    };

    const [reglas, total] = await prisma.$transaction([
      prisma.reglaRecurrencia.findMany({
        where,
        select: REGLA_SELECT,
        orderBy: [{ activo: "desc" }, { proximaFechaEjecucion: "asc" }, { id: "asc" }],
        skip,
        take: safeLimit,
      }),
      prisma.reglaRecurrencia.count({ where }),
    ]);

    return res.json({
      success: true,
      data: reglas,
      total,
      page: safePage,
      limit: safeLimit,
    });
  } catch (error) {
    console.error("[recurrencias] listarReglasGlobal error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

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
