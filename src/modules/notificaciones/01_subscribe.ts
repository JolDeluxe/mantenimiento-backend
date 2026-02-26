import type { Request, Response } from "express";
import { prisma } from "../../db"; 
import { registrarAccion, registrarError } from "../../utils/logger"; 
import type { SubscriptionInput } from "./zod";

export const subscribe = async (req: Request, res: Response) => {
  // Garantizamos que usuarioId existe porque pasó por el middleware 'authenticate'
  const usuarioId = req.user!.id; 
  
  // Tipamos el body con la validación de Zod
  const { endpoint, keys } = req.body as SubscriptionInput;

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

    return res.status(201).json({ message: "Suscripción activada correctamente" });

  } catch (error) {
    await registrarError("SUSCRIPCION_PUSH_FAIL", usuarioId, error);
    return res.status(500).json({ message: "Error interno al suscribir dispositivo" });
  }
};