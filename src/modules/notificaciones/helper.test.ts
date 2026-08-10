import { describe, expect, it } from "bun:test";
import { enviarPayloadASuscripciones, type PushDeliveryDependencies, type PushSubscriptionRecord } from "./helper";

const sub = (id: number, endpoint: string): PushSubscriptionRecord => ({
  id,
  endpoint,
  p256dh: `p256dh-${id}`,
  auth: `auth-${id}`,
});

const statusError = (statusCode: number) => Object.assign(new Error(`push ${statusCode}`), { statusCode });

const createDeps = (failures: Record<string, number> = {}) => {
  const sent: string[] = [];
  const success: number[] = [];
  const dead: number[] = [];
  const transient: number[] = [];
  const logged: string[] = [];

  const deps: PushDeliveryDependencies = {
    sendNotification: async (subscription) => {
      sent.push(subscription.endpoint);
      const statusCode = failures[subscription.endpoint];
      if (statusCode) throw statusError(statusCode);
    },
    markSuccess: async (subscription) => {
      success.push(subscription.id);
    },
    removeDead: async (subscription) => {
      dead.push(subscription.id);
    },
    markTransientFailure: async (subscription) => {
      transient.push(subscription.id);
    },
    logError: async (contexto) => {
      logged.push(contexto);
    },
  };

  return { deps, sent, success, dead, transient, logged };
};

describe("Web Push delivery helper", () => {
  it("envía una suscripción válida y registra éxito", async () => {
    const ctx = createDeps();

    const summary = await enviarPayloadASuscripciones([sub(1, "ok-1")], "{}", ctx.deps);

    expect(ctx.sent).toEqual(["ok-1"]);
    expect(ctx.success).toEqual([1]);
    expect(ctx.dead).toEqual([]);
    expect(ctx.transient).toEqual([]);
    expect(summary).toEqual({
      dispositivosObjetivo: 1,
      enviadosExito: 1,
      fallidos: 0,
      expirados: 0,
      temporales: 0,
    });
  });

  it("elimina idempotentemente suscripciones 410 y continúa el lote", async () => {
    const ctx = createDeps({ dead: 410 });

    const summary = await enviarPayloadASuscripciones([sub(1, "dead"), sub(2, "ok")], "{}", ctx.deps);

    expect(ctx.sent).toEqual(["dead", "ok"]);
    expect(ctx.dead).toEqual([1]);
    expect(ctx.success).toEqual([2]);
    expect(summary.enviadosExito).toBe(1);
    expect(summary.expirados).toBe(1);
    expect(summary.temporales).toBe(0);
  });

  it("elimina idempotentemente suscripciones 404", async () => {
    const ctx = createDeps({ gone: 404 });

    const summary = await enviarPayloadASuscripciones([sub(1, "gone")], "{}", ctx.deps);

    expect(ctx.dead).toEqual([1]);
    expect(ctx.transient).toEqual([]);
    expect(summary.expirados).toBe(1);
  });

  it("dos errores 410 concurrentes del mismo id no propagan P2025", async () => {
    const ctx = createDeps({ "dead-a": 410, "dead-b": 410 });

    const summary = await enviarPayloadASuscripciones(
      [sub(1, "dead-a"), sub(1, "dead-b")],
      "{}",
      ctx.deps
    );

    expect(ctx.dead).toEqual([1, 1]);
    expect(summary.expirados).toBe(2);
    expect(summary.fallidos).toBe(2);
  });

  it("429 y 500 son transitorios y no borran suscripciones", async () => {
    const ctx = createDeps({ limited: 429, server: 500 });

    const summary = await enviarPayloadASuscripciones(
      [sub(1, "limited"), sub(2, "server")],
      "{}",
      ctx.deps
    );

    expect(ctx.dead).toEqual([]);
    expect(ctx.transient).toEqual([1, 2]);
    expect(summary.expirados).toBe(0);
    expect(summary.temporales).toBe(2);
  });

  it("varias suscripciones: una muerta no cancela dispositivos válidos", async () => {
    const ctx = createDeps({ dead: 410 });

    const summary = await enviarPayloadASuscripciones(
      [sub(1, "ok-1"), sub(2, "dead"), sub(3, "ok-2")],
      "{}",
      ctx.deps
    );

    expect(ctx.success).toEqual([1, 3]);
    expect(ctx.dead).toEqual([2]);
    expect(summary.dispositivosObjetivo).toBe(3);
    expect(summary.enviadosExito).toBe(2);
    expect(summary.expirados).toBe(1);
  });

  it("múltiples dispositivos del mismo usuario reciben una vez por endpoint", async () => {
    const ctx = createDeps();

    await enviarPayloadASuscripciones([sub(1, "pc"), sub(2, "android"), sub(3, "ios")], "{}", ctx.deps);

    expect(ctx.sent.sort()).toEqual(["android", "ios", "pc"]);
    expect(ctx.success.sort()).toEqual([1, 2, 3]);
  });

  it("deduplica el mismo endpoint para evitar envíos duplicados", async () => {
    const ctx = createDeps();

    const summary = await enviarPayloadASuscripciones(
      [sub(1, "same-endpoint"), sub(2, "same-endpoint")],
      "{}",
      ctx.deps
    );

    expect(ctx.sent).toEqual(["same-endpoint"]);
    expect(summary.dispositivosObjetivo).toBe(1);
    expect(summary.enviadosExito).toBe(1);
  });
});
