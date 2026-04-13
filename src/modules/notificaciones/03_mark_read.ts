import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarError } from "../../utils/logger";
import type { MarkReadParams, MarkActionedParams } from "./zod";

export const marcarComoLeida = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    const { id } = req.params as unknown as MarkReadParams;

    const notif = await prisma.notificacion.findUnique({ where: { id } });

    if (!notif || notif.usuarioId !== usuarioId) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }

    const actualizada = await prisma.notificacion.update({
      where: { id },
      data: { leida: true },
    });

    return res.json({ status: "success", data: actualizada });

  } catch (error) {
    await registrarError("MARK_NOTIF_READ", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al marcar notificación" });
  }
};

export const marcarTodasComoLeidas = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;

    await prisma.notificacion.updateMany({
      where: { usuarioId, leida: false },
      data: { leida: true },
    });

    return res.json({ status: "success", message: "Todas las notificaciones marcadas como leídas" });

  } catch (error) {
    await registrarError("MARK_ALL_READ", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al marcar notificaciones" });
  }
};

export const marcarComoAccionada = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    const { id } = req.params as unknown as MarkActionedParams;

    const notif = await prisma.notificacion.findUnique({ where: { id } });

    if (!notif || notif.usuarioId !== usuarioId) {
      return res.status(404).json({ error: "Notificación no encontrada" });
    }

    const actualizada = await prisma.notificacion.update({
      where: { id },
      data: { leida: true, accionada: true },
    });

    return res.json({ status: "success", data: actualizada });

  } catch (error) {
    await registrarError("MARK_NOTIF_ACTIONED", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al marcar notificación como accionada" });
  }
};