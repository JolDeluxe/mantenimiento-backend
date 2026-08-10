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

const activePushTasks = new Set<Promise<void>>();
let pushShutdownInProgress = false;

type PushSendResult = "ENVIADA" | "SUSCRIPCION_EXPIRADA" | "ERROR_TEMPORAL";

export type PushSubscriptionRecord = Pick<PushSubscription, "id" | "endpoint" | "p256dh" | "auth">;

export type PushDeliveryDependencies = {
  sendNotification: (
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string
  ) => Promise<unknown>;
  markSuccess: (sub: PushSubscriptionRecord) => Promise<unknown>;
  removeDead: (sub: PushSubscriptionRecord) => Promise<unknown>;
  markTransientFailure: (sub: PushSubscriptionRecord) => Promise<unknown>;
  logError?: (contexto: string, error: unknown) => Promise<unknown>;
};

export type PushBatchSummary = {
  dispositivosObjetivo: number;
  enviadosExito: number;
  fallidos: number;
  expirados: number;
  temporales: number;
};

const getPushStatusCode = (error: unknown): number | null => {
  const maybeError = error as { statusCode?: unknown; status?: unknown };
  const statusCode = Number(maybeError?.statusCode ?? maybeError?.status);
  return Number.isFinite(statusCode) ? statusCode : null;
};

const isDeadPushSubscriptionError = (error: unknown) => {
  const statusCode = getPushStatusCode(error);
  return statusCode === 404 || statusCode === 410;
};

const deduplicarSuscripcionesPorEndpoint = (suscripciones: PushSubscriptionRecord[]) => {
  const porEndpoint = new Map<string, PushSubscriptionRecord>();
  for (const sub of suscripciones) {
    if (!porEndpoint.has(sub.endpoint)) {
      porEndpoint.set(sub.endpoint, sub);
    }
  }
  return Array.from(porEndpoint.values());
};

const safeTelemetry = async (
  contexto: string,
  sub: PushSubscriptionRecord,
  action: () => Promise<unknown>,
  logError?: PushDeliveryDependencies["logError"]
) => {
  try {
    await action();
  } catch (error) {
    console.error(`[${contexto}] Falló telemetría push para SubID ${sub.id}:`, error);
    await logError?.(contexto, error).catch(() => undefined);
  }
};

export const enviarPayloadASuscripciones = async (
  suscripciones: PushSubscriptionRecord[],
  payloadString: string,
  deps: PushDeliveryDependencies
): Promise<PushBatchSummary> => {
  const suscripcionesUnicas = deduplicarSuscripcionesPorEndpoint(suscripciones);

  const resultados = await Promise.allSettled(
    suscripcionesUnicas.map(async (sub): Promise<PushSendResult> => {
      try {
        await deps.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payloadString
        );

        await safeTelemetry("PUSH_SUCCESS_TELEMETRY_FAIL", sub, () => deps.markSuccess(sub), deps.logError);
        return "ENVIADA";
      } catch (error) {
        if (isDeadPushSubscriptionError(error)) {
          console.warn(`[PUSH CLEANUP] Suscripción expirada (${getPushStatusCode(error)}), SubID ${sub.id}.`);
          await safeTelemetry("PUSH_DEAD_CLEANUP_FAIL", sub, () => deps.removeDead(sub), deps.logError);
          return "SUSCRIPCION_EXPIRADA";
        }

        console.error(`[PUSH FAIL] Error temporal en SubID ${sub.id}:`, error);
        await safeTelemetry("PUSH_TRANSIENT_TELEMETRY_FAIL", sub, () => deps.markTransientFailure(sub), deps.logError);
        return "ERROR_TEMPORAL";
      }
    })
  );

  const estados = resultados.map((result) => (
    result.status === "fulfilled" ? result.value : "ERROR_TEMPORAL"
  ));

  const enviadosExito = estados.filter((estado) => estado === "ENVIADA").length;
  const expirados = estados.filter((estado) => estado === "SUSCRIPCION_EXPIRADA").length;
  const temporales = estados.filter((estado) => estado === "ERROR_TEMPORAL").length;

  return {
    dispositivosObjetivo: suscripcionesUnicas.length,
    enviadosExito,
    fallidos: expirados + temporales,
    expirados,
    temporales,
  };
};

export const iniciarShutdownPush = () => {
  pushShutdownInProgress = true;
};

export const getActivePushTaskCount = () => activePushTasks.size;

export const esperarPushesActivos = async (timeoutMs: number) => {
  if (activePushTasks.size === 0) {
    return { completed: true, pending: 0 };
  }

  let timedOut = false;
  await Promise.race([
    Promise.allSettled(Array.from(activePushTasks)),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs).unref?.();
    }),
  ]);

  return { completed: !timedOut, pending: activePushTasks.size };
};

export const enviarNotificacionPush = async (
  usuarioId: number,
  payload: NotificationPayload
) => {
  if (pushShutdownInProgress) {
    console.warn(`[PUSH SHUTDOWN] Envío omitido para usuario ${usuarioId}: shutdown en progreso.`);
    return;
  }

  const task = enviarNotificacionPushInterna(usuarioId, payload);
  activePushTasks.add(task);

  try {
    await task;
  } finally {
    activePushTasks.delete(task);
  }
};

const enviarNotificacionPushInterna = async (
  usuarioId: number,
  payload: NotificationPayload
) => {
  try {
    const log = await prisma.notificacionLog.create({
      data: {
        usuarioId,
        titulo: payload.title,
        cuerpo: payload.body,
        dispositivosObjetivo: 0,
        enviadosExito: 0,
        fallidos: 0,
      },
    });

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

    // 2. Procesamiento Paralelo con Telemetría Individual
    const resumen = await enviarPayloadASuscripciones(suscripciones, payloadString, {
      sendNotification: webpush.sendNotification.bind(webpush),
      markSuccess: (sub) => prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: {
          lastSuccess: new Date(),
          failureCount: 0 // Reseteamos contador de fallos
        },
      }),
      removeDead: (sub) => prisma.pushSubscription.deleteMany({
        where: { id: sub.id },
      }),
      markTransientFailure: (sub) => prisma.pushSubscription.updateMany({
        where: { id: sub.id },
        data: { failureCount: { increment: 1 } },
      }),
      logError: (contexto, error) => registrarError(contexto, usuarioId, error),
    });

    // 3. Cierre de BITÁCORA: Guardamos los resultados finales
    await prisma.notificacionLog.update({
      where: { id: log.id },
      data: {
        dispositivosObjetivo: resumen.dispositivosObjetivo,
        enviadosExito: resumen.enviadosExito,
        fallidos: resumen.fallidos,
      },
    });

  } catch (error) {
    await registrarError("PUSH_SYSTEM_CRITICAL", usuarioId, error).catch(() => undefined);
  }
};
