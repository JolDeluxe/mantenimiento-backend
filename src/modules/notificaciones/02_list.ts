import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarError } from "../../utils/logger";
import type { ListNotificacionesQuery } from "./zod";

export const listarNotificaciones = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    const { page, limit, soloNoLeidas, tipo } =
      req.query as unknown as ListNotificacionesQuery;

    const offset = (page - 1) * limit;

    const whereClause: Record<string, unknown> = { usuarioId };
    if (soloNoLeidas) whereClause.leida = false;
    if (tipo)         whereClause.tipo  = tipo;

    const [total, noLeidas, notificaciones] = await Promise.all([
      prisma.notificacion.count({ where: whereClause }),
      prisma.notificacion.count({ where: { usuarioId, leida: false } }),
      prisma.notificacion.findMany({
        where:   whereClause,
        take:    limit,
        skip:    offset,
        orderBy: [
          { createdAt: "desc" },
          { id: "desc" } // Desempate determinista
        ],
        include: {
          tarea: { select: { estado: true } },
        },
      }),
    ]);

    return res.json({
      status: "success",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      noLeidas,
      data: notificaciones,
    });

  } catch (error) {
    await registrarError("LIST_NOTIFICACIONES", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al obtener notificaciones" });
  }
};

export const obtenerConteoNoLeidas = async (req: Request, res: Response) => {
  try {
    const count = await prisma.notificacion.count({
      where: { usuarioId: req.user!.id, leida: false },
    });
    return res.json({ count });
  } catch (error) {
    await registrarError("GET_UNREAD_COUNT", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al obtener conteo" });
  }
};