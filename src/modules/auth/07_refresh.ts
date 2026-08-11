import { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { env } from "../../env";
import type { TokenPayload } from "./types";
import {
  clearAuthCookies,
  createPersistentSession,
  getRefreshTokenFromRequest,
  getSessionIdFromRefreshToken,
  issueAccessForSession,
  validatePersistentSession,
  setAccessCookie,
  setRefreshCookie,
} from "./session";

const isTokenError = (error: unknown) => (
  error instanceof Error &&
  ["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)
);

const buildPayload = (usuario: {
  id: number;
  username: string;
  email: string | null;
  rol: string;
  nombre: string;
  departamentoId: number | null;
}): TokenPayload => ({
  id: usuario.id,
  username: usuario.username,
  email: usuario.email,
  rol: usuario.rol,
  nombre: usuario.nombre,
  departamentoId: usuario.departamentoId,
});

const migrateLegacyRefreshToken = async (req: Request, refreshToken: string) => {
  const decoded = jwt.verify(refreshToken, env.JWT_SECRET) as { id: number };

  const storedTokens = await prisma.refreshToken.findMany({
    where: {
      usuarioId: decoded.id,
      revoked: false,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
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

  for (const token of storedTokens) {
    const match = await bcrypt.compare(refreshToken, token.hashedToken).catch(() => false);
    if (!match) continue;

    if (token.usuario.estado !== "ACTIVO") return null;

    await prisma.refreshToken.update({
      where: { id: token.id },
      data: { revoked: true, revokedAt: new Date() },
    });

    const session = await createPersistentSession(req, token.usuarioId);

    return {
      usuario: token.usuario,
      sessionId: session.sessionId,
      refreshToken: session.refreshToken,
    };
  }

  return null;
};

export const refreshSession = async (req: Request, res: Response) => {
  try {
    const refreshToken = getRefreshTokenFromRequest(req);
    if (!refreshToken) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "Sesión inválida o expirada" });
    }

    const sessionId = getSessionIdFromRefreshToken(refreshToken);
    const session = sessionId
      ? await validatePersistentSession(req, sessionId, refreshToken)
      : await migrateLegacyRefreshToken(req, refreshToken);

    if (!session) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "Sesión inválida o expirada" });
    }

    const accessToken = issueAccessForSession(buildPayload(session.usuario), session.sessionId);

    setAccessCookie(req, res, accessToken);
    setRefreshCookie(req, res, session.refreshToken);

    return res.status(200).json({
      status: "success",
      user: {
        id: session.usuario.id,
        nombre: session.usuario.nombre,
        username: session.usuario.username,
        rol: session.usuario.rol,
        departamentoId: session.usuario.departamentoId,
        email: session.usuario.email || undefined,
      },
    });
  } catch (error) {
    if (isTokenError(error)) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "Sesión caducada" });
    }

    return res.status(503).json({
      status: "error",
      message: "Servicio de autenticación temporalmente no disponible",
    });
  }
};
