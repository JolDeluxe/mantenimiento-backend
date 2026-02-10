import type { Request, Response } from "express";
import { prisma } from "../../db"; 
import { registrarAccion, registrarError } from "../../utils/logger"; 

export const subscribe = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id; 
  const { endpoint, keys } = req.body;

  if (!usuarioId) return res.status(401).json({ message: "No autorizado" });

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        usuarioId,
      },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        usuarioId,
      },
    });

    await registrarAccion(
      "SUSCRIPCION_PUSH", 
      usuarioId, 
      "Dispositivo activado para recibir notificaciones"
    );

    res.status(201).json({ message: "Suscripción activada correctamente" });

  } catch (error) {
    await registrarError(
      "SUSCRIPCION_PUSH_FAIL", 
      usuarioId, 
      error
    );

    res.status(500).json({ message: "Error interno al suscribir dispositivo" });
  }
};