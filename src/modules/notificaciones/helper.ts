import webpush from "web-push";
import { prisma } from "../../db";
import { env } from "../../env";
import { registrarError } from "../../utils/logger";
import type { PushSubscription } from "@prisma/client";
import type { NotificationPayload } from "./types";

// Configuración inicial
webpush.setVapidDetails(
  env.VAPID_MAILTO,
  env.VAPID_PUBLIC_KEY,
  env.VAPID_PRIVATE_KEY
);

export const enviarNotificacionPush = async (
  usuarioId: number,
  payload: NotificationPayload
) => {
  // 1. Crear el registro en BITÁCORA (Estado inicial)
  // Regresamos a la forma pura y directa de Prisma. Cero condiciones, 100% type-safe.
  const log = await prisma.notificacionLog.create({
    data: {
      usuarioId, // <-- La solución. Directo y sin intermediarios.
      titulo: payload.title,
      cuerpo: payload.body,
      dispositivosObjetivo: 0,
      enviadosExito: 0,
      fallidos: 0,
    },
  });

  try {
    const suscripciones = await prisma.pushSubscription.findMany({
      where: { usuarioId },
    });

    // Actualizamos el log con el número real de dispositivos
    if (suscripciones.length === 0) {
      await prisma.notificacionLog.update({
        where: { id: log.id },
        data: { dispositivosObjetivo: 0 },
      });
      return; 
    }

    const payloadString = JSON.stringify(payload);
    let exitos = 0;
    let fallos = 0;

    // 2. Procesamiento Paralelo con Telemetría Individual
    const promesas = suscripciones.map(async (sub: PushSubscription) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadString
        );

        // A. ÉXITO: Actualizamos la salud de la suscripción
        exitos++;
        await prisma.pushSubscription.update({
          where: { id: sub.id },
          data: { 
            lastSuccess: new Date(),
            failureCount: 0 // Reseteamos contador de fallos
          },
        });

      } catch (error: any) {
        fallos++;
        
        // B. ERROR: Analizamos la causa
        if (error.statusCode === 410 || error.statusCode === 404) {
          // Caso: Dispositivo ya no existe (usuario borró caché o desinstaló) -> ELIMINAR
          console.warn(`[PUSH CLEANUP] Eliminando suscripción muerta: ${sub.id}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } });
        } else {
          // Caso: Error de red o servidor -> Aumentar contador de fallos
          await prisma.pushSubscription.update({
            where: { id: sub.id },
            data: { failureCount: { increment: 1 } },
          });
          console.error(`[PUSH FAIL] SubID ${sub.id}:`, error.message);
        }
      }
    });

    await Promise.allSettled(promesas);

    // 3. Cierre de BITÁCORA: Guardamos los resultados finales
    await prisma.notificacionLog.update({
      where: { id: log.id },
      data: {
        dispositivosObjetivo: suscripciones.length,
        enviadosExito: exitos,
        fallidos: fallos,
      },
    });

  } catch (error) {
    await registrarError("PUSH_SYSTEM_CRITICAL", usuarioId, error);
  }
};