import { type Request, type Response } from "express";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import type { LogoutInput } from "./zod";
import {
  clearAuthCookies,
  getRefreshTokenFromRequest,
  getSessionIdFromRefreshToken,
  revokeAllUserSessions,
  revokeSession,
} from "./session";

type PushSubscriptionDeleteRepo = {
  pushSubscription: {
    deleteMany: (args: { where: { usuarioId: number; endpoint: string } }) => Promise<unknown>;
  };
};

export const desasociarEndpointPushUsuario = async (
  usuarioId: number | undefined,
  endpoint: string | undefined,
  db: PushSubscriptionDeleteRepo = prisma
) => {
  if (!usuarioId || !endpoint) return null;

  return db.pushSubscription.deleteMany({
    where: {
      usuarioId,
      endpoint,
    },
  });
};

export const logout = async (req: Request, res: Response) => {
  try {
    const { endpoint } = (req.body || {}) as LogoutInput;
    const sessionId = req.user?.sessionId || getSessionIdFromRefreshToken(getRefreshTokenFromRequest(req));

    if (!sessionId) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "Sesión no disponible" });
    }

    const session = await prisma.refreshToken.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        usuarioId: true,
        revoked: true,
        revokedAt: true,
      },
    });

    if (!session || session.revoked || session.revokedAt) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "Sesión inválida o revocada" });
    }

    await revokeSession(sessionId);
    await desasociarEndpointPushUsuario(session.usuarioId, endpoint);
    clearAuthCookies(req, res);

    await registrarAccion("LOGOUT", session.usuarioId, "Cierre de sesión exitoso");

    return res.status(200).json({
      status: "success",
      message: "Sesión cerrada correctamente",
    });
  } catch (error) {
    return res.status(503).json({ status: "error", message: "Servicio de autenticación temporalmente no disponible" });
  }
};

export const logoutAll = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user?.id;
    if (!usuarioId) {
      clearAuthCookies(req, res);
      return res.status(401).json({ status: "error", message: "No autenticado" });
    }

    await revokeAllUserSessions(usuarioId);
    clearAuthCookies(req, res);
    await registrarAccion("LOGOUT_ALL", usuarioId, "Cierre de todas las sesiones");

    return res.status(200).json({
      status: "success",
      message: "Todas las sesiones fueron cerradas correctamente",
    });
  } catch (error) {
    return res.status(500).json({ status: "error", message: "Error al cerrar sesiones" });
  }
};
