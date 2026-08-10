import type { Request, Response } from "express";
import { prisma } from "../../db"; 
import { registrarAccion, registrarError } from "../../utils/logger"; 
import type { SubscriptionInput } from "./zod";

type PushSubscriptionUpsertRepo = {
  pushSubscription: {
    upsert: (args: {
      where: { endpoint: string };
      update: {
        p256dh: string;
        auth: string;
        usuarioId: number;
        lastSuccess: Date;
        failureCount: number;
      };
      create: {
        endpoint: string;
        p256dh: string;
        auth: string;
        usuarioId: number;
      };
    }) => Promise<unknown>;
  };
};

export const registrarPushSubscription = (
  usuarioId: number,
  { endpoint, keys }: SubscriptionInput,
  db: PushSubscriptionUpsertRepo = prisma
) => db.pushSubscription.upsert({
  where: { endpoint },
  update: {
    p256dh: keys.p256dh,
    auth: keys.auth,
    usuarioId,
    lastSuccess: new Date(),
    failureCount: 0
  },
  create: {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    usuarioId,
  },
});

export const subscribe = async (req: Request, res: Response) => {
  // 1. Extracción segura del usuario inyectado por el middleware authenticate
  const usuarioId = req.user?.id; 

  if (!usuarioId) {
    return res.status(401).json({ message: "Sesión inválida" });
  }
  
  // 2. Extracción de datos validados por el middleware validate(subscriptionSchema)
  // Nota: Asegúrate que el frontend mande el objeto exactamente como pide tu Zod
  const { endpoint, keys } = req.body as SubscriptionInput;

  try {
    // 3. Operación Atómica Upsert
    // Usamos el endpoint como identificador único del dispositivo
    await registrarPushSubscription(usuarioId, { endpoint, keys });

    // 4. Auditoría en Bitácora
    await registrarAccion(
      "SUSCRIPCION_PUSH", 
      usuarioId, 
      `Dispositivo registrado exitosamente. Endpoint: ${endpoint.substring(0, 30)}...`
    );

    // 5. Respuesta uniforme
    // Importante: El frontend espera un status 201 para confirmar el log "[Push] Suscripción activada ✅"
    return res.status(201).json({ 
      success: true,
      message: "Suscripción activada correctamente" 
    });

  } catch (error) {
    await registrarError("SUSCRIPCION_PUSH_FAIL", usuarioId, error);
    return res.status(500).json({ 
      success: false,
      message: "Error interno al suscribir dispositivo" 
    });
  }
};
