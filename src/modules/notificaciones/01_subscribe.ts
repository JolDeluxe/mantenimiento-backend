import type { Request, Response } from "express";
import { prisma } from "../../db"; 
import { registrarAccion, registrarError } from "../../utils/logger"; 
import type { SubscriptionInput } from "./zod";

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
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: {
        p256dh: keys.p256dh,
        auth: keys.auth,
        usuarioId,
        lastSuccess: new Date(), // Marcamos actividad
        failureCount: 0          // Reseteamos fallos si el dispositivo vuelve a suscribirse
      },
      create: {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        usuarioId,
      },
    });

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