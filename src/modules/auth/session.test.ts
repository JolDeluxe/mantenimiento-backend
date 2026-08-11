import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCESS_TOKEN_MAX_AGE_MS,
  REFRESH_COOKIE_MAX_AGE_MS,
  getSessionIdFromRefreshToken,
  isPersistentSessionActive,
  sessionTokenHashForTest,
} from "./session";
import { refreshTokenSchema } from "./zod";

describe("Auth refresh session helpers", () => {
  it("extrae sessionId desde refresh token opaco", () => {
    expect(getSessionIdFromRefreshToken("session-123.secret-456")).toBe("session-123");
  });

  it("rechaza tokens sin formato session.secret", () => {
    expect(getSessionIdFromRefreshToken("legacy.jwt.token")).toBeNull();
    expect(getSessionIdFromRefreshToken("sin-secreto")).toBeNull();
    expect(getSessionIdFromRefreshToken(undefined)).toBeNull();
  });

  it("mantiene access corto y cookie persistente larga", () => {
    expect(ACCESS_TOKEN_MAX_AGE_MS).toBe(8 * 60 * 60 * 1000);
    expect(REFRESH_COOKIE_MAX_AGE_MS).toBe(400 * 24 * 60 * 60 * 1000);
  });

  it("considera activa una sesión permanente con expiresAt null aunque lastUsedAt sea antiguo", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(isPersistentSessionActive({
      revoked: false,
      revokedAt: null,
      expiresAt: null,
      usuario: { estado: "ACTIVO" },
    }, now)).toBe(true);
  });

  it("mantiene compatibilidad con expiración opcional para sesiones legacy no revocadas", () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    expect(isPersistentSessionActive({
      revoked: false,
      revokedAt: null,
      expiresAt: new Date("2026-08-11T12:01:00.000Z"),
      usuario: { estado: "ACTIVO" },
    }, now)).toBe(true);

    expect(isPersistentSessionActive({
      revoked: false,
      revokedAt: null,
      expiresAt: new Date("2026-08-11T11:59:00.000Z"),
      usuario: { estado: "ACTIVO" },
    }, now)).toBe(false);
  });

  it("rechaza sesiones revocadas o con usuario inactivo", () => {
    expect(isPersistentSessionActive({
      revoked: true,
      revokedAt: null,
      expiresAt: null,
      usuario: { estado: "ACTIVO" },
    })).toBe(false);

    expect(isPersistentSessionActive({
      revoked: false,
      revokedAt: new Date(),
      expiresAt: null,
      usuario: { estado: "ACTIVO" },
    })).toBe(false);

    expect(isPersistentSessionActive({
      revoked: false,
      revokedAt: null,
      expiresAt: null,
      usuario: { estado: "INACTIVO" },
    })).toBe(false);
  });

  it("guarda hash y no el secret real de la credencial persistente", () => {
    const token = "session-123.secret-456";
    const hash = sessionTokenHashForTest(token);

    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
    expect(hash).toBe(sessionTokenHashForTest(token));
  });

  it("el schema permite sesiones persistentes sin expiresAt obligatorio", () => {
    const schema = readFileSync(resolve(import.meta.dir, "../../../prisma/schema.prisma"), "utf8");
    expect(schema).toContain("expiresAt DateTime?");
  });

  it("el seed normal no borra RefreshToken directamente y aborta en producción", () => {
    const seed = readFileSync(resolve(import.meta.dir, "../../../prisma/seed.ts"), "utf8");
    expect(seed).not.toContain("prisma.refreshToken.deleteMany({})");
    expect(seed).toContain('nodeEnv === "production"');
    expect(seed).toContain("ABORTANDO SEED");
  });

  it("normaliza refresh legacy vacío o nulo para que el controller devuelva 401 y no un 400 de validación", () => {
    expect(refreshTokenSchema.parse({ body: { refreshToken: "" } }).body.refreshToken).toBeUndefined();
    expect(refreshTokenSchema.parse({ body: { refreshToken: null } }).body.refreshToken).toBeUndefined();
  });
});
