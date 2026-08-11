import crypto from "crypto";
import type { Request, Response, CookieOptions } from "express";
import { prisma } from "../../db";
import { env } from "../../env";
import { generateAccessToken } from "./utils/tokenGenerator";
import type { TokenPayload } from "./types";

export const ACCESS_COOKIE_NAME = "access_token";
export const REFRESH_COOKIE_NAME = "refresh_token";

export const ACCESS_TOKEN_MAX_AGE_MS = 8 * 60 * 60 * 1000;
export const REFRESH_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

type SessionValidityInput = {
  revoked: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
  usuario?: {
    estado: string;
  } | null;
};

export const isPersistentSessionActive = (
  session: SessionValidityInput | null | undefined,
  now = new Date()
) => {
  if (!session || session.revoked || session.revokedAt) return false;
  if (session.expiresAt && session.expiresAt <= now) return false;
  if (session.usuario && session.usuario.estado !== "ACTIVO") return false;
  return true;
};

const parseCookies = (header: string | undefined): Record<string, string> => {
  if (!header) return {};

  return header.split(";").reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (!rawKey || rawValue.length === 0) return acc;
    acc[rawKey] = decodeURIComponent(rawValue.join("="));
    return acc;
  }, {});
};

export const getCookie = (req: Request, name: string): string | undefined => {
  return parseCookies(req.headers.cookie)[name];
};

const isHttpsRequest = (req: Request) => {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
};

const baseCookieOptions = (req: Request, maxAge: number): CookieOptions => {
  const secure = env.NODE_ENV === "production" && isHttpsRequest(req);

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge,
    path: "/",
  };
};

export const clearAuthCookies = (req: Request, res: Response) => {
  const options = baseCookieOptions(req, 0);
  res.clearCookie(ACCESS_COOKIE_NAME, options);
  res.clearCookie(REFRESH_COOKIE_NAME, options);
};

export const setAccessCookie = (req: Request, res: Response, accessToken: string) => {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, baseCookieOptions(req, ACCESS_TOKEN_MAX_AGE_MS));
};

export const setRefreshCookie = (req: Request, res: Response, refreshToken: string) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, baseCookieOptions(req, REFRESH_COOKIE_MAX_AGE_MS));
};

const buildRefreshToken = (sessionId: string) => {
  const secret = crypto.randomBytes(48).toString("base64url");
  return `${sessionId}.${secret}`;
};

export const getSessionIdFromRefreshToken = (refreshToken: string | undefined | null) => {
  if (!refreshToken) return null;
  const parts = refreshToken.split(".");
  if (parts.length !== 2) return null;
  const [sessionId, secret] = parts;
  if (!sessionId || !secret) return null;
  return sessionId;
};

export const createPersistentSession = async (req: Request, usuarioId: number) => {
  const session = await prisma.refreshToken.create({
    data: {
      hashedToken: "pending",
      usuarioId,
      expiresAt: null,
      lastUsedAt: new Date(),
      userAgent: req.headers["user-agent"]?.slice(0, 500),
      ip: req.ip?.slice(0, 64),
    },
  });

  const refreshToken = buildRefreshToken(session.id);

  await prisma.refreshToken.update({
    where: { id: session.id },
    data: { hashedToken: sha256(refreshToken) },
  });

  return {
    sessionId: session.id,
    refreshToken,
    expiresAt: null,
  };
};

export const validatePersistentSession = async (req: Request, sessionId: string, refreshToken: string) => {
  const now = new Date();
  const session = await prisma.refreshToken.findUnique({
    where: { id: sessionId },
    include: {
      usuario: {
        select: {
          id: true,
          username: true,
          email: true,
          rol: true,
          nombre: true,
          departamentoId: true,
          estado: true,
        },
      },
    },
  });

  if (!session || !isPersistentSessionActive(session, now)) {
    return null;
  }

  if (session.hashedToken !== sha256(refreshToken)) {
    return null;
  }

  if (session.usuario.estado !== "ACTIVO") {
    await prisma.refreshToken.update({
      where: { id: session.id },
      data: { revoked: true, revokedAt: now },
    });
    return null;
  }

  await prisma.refreshToken.update({
    where: { id: session.id },
    data: {
      lastUsedAt: now,
      userAgent: req.headers["user-agent"]?.slice(0, 500),
      ip: req.ip?.slice(0, 64),
    },
  });

  return {
    sessionId: session.id,
    refreshToken,
    expiresAt: session.expiresAt,
    usuario: session.usuario,
  };
};

export const issueAccessForSession = (payload: TokenPayload, sessionId: string) => {
  return generateAccessToken({ ...payload, sid: sessionId });
};

export const revokeSession = async (sessionId: string | null | undefined) => {
  if (!sessionId) return null;

  return prisma.refreshToken.updateMany({
    where: {
      id: sessionId,
      revoked: false,
    },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  });
};

export const revokeAllUserSessions = async (usuarioId: number) => {
  return prisma.refreshToken.updateMany({
    where: {
      usuarioId,
      revoked: false,
    },
    data: {
      revoked: true,
      revokedAt: new Date(),
    },
  });
};

export const getAccessTokenFromRequest = (req: Request) => {
  const cookieToken = getCookie(req, ACCESS_COOKIE_NAME);
  if (cookieToken) return cookieToken;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    // LEGACY COMPATIBILITY: se conserva temporalmente para frontends cacheados.
    return authHeader.split(" ")[1];
  }

  return undefined;
};

export const getRefreshTokenFromRequest = (req: Request) => {
  // LEGACY COMPATIBILITY: req.body.refreshToken migra sesiones antiguas en localStorage.
  return getCookie(req, REFRESH_COOKIE_NAME) || req.body?.refreshToken;
};

export const sessionTokenHashForTest = sha256;
