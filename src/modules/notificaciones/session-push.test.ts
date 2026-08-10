import { describe, expect, it } from "bun:test";
import { desasociarEndpointPushUsuario } from "../auth/08_logout";
import { registrarPushSubscription } from "./01_subscribe";

describe("Web Push session association", () => {
  it("logout elimina la asociación BD del endpoint sin desuscribir el navegador", async () => {
    const calls: unknown[] = [];
    const db = {
      pushSubscription: {
        deleteMany: async (args: unknown) => {
          calls.push(args);
          return { count: 1 };
        },
      },
    };

    await desasociarEndpointPushUsuario(10, "https://push.example.test/endpoint-x", db);

    expect(calls).toEqual([
      {
        where: {
          usuarioId: 10,
          endpoint: "https://push.example.test/endpoint-x",
        },
      },
    ]);
  });

  it("cambio A a B reasocia el mismo endpoint exclusivamente al usuario actual", async () => {
    const upserts: unknown[] = [];
    const db = {
      pushSubscription: {
        upsert: async (args: unknown) => {
          upserts.push(args);
          return {};
        },
      },
    };

    await registrarPushSubscription(
      20,
      {
        endpoint: "https://push.example.test/endpoint-x",
        keys: { p256dh: "p256dh-b", auth: "auth-b" },
      },
      db
    );

    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      where: { endpoint: "https://push.example.test/endpoint-x" },
      update: {
        p256dh: "p256dh-b",
        auth: "auth-b",
        usuarioId: 20,
        failureCount: 0,
      },
      create: {
        endpoint: "https://push.example.test/endpoint-x",
        p256dh: "p256dh-b",
        auth: "auth-b",
        usuarioId: 20,
      },
    });
  });
});
