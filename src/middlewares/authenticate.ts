import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { env } from "../env";
import { Estatus } from "@prisma/client";
import type { TokenPayload } from "../modules/auth/types";
import { getAccessTokenFromRequest } from "../modules/auth/session";

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const token = getAccessTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: "Token no proporcionado o formato incorrecto" });
  }

  try {
    const decoded = jwt.verify(
      token,
      env.JWT_SECRET as string 
    ) as unknown as TokenPayload;

    if (!decoded.sid) {
      return res.status(401).json({ error: "Sesión no proporcionada" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.id },
      select: { 
        id: true, 
        username: true,
        nombre: true,
        email: true, 
        rol: true, 
        estado: true, 
        departamentoId: true 
      }
    });

    if (!usuario) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    if (usuario.estado !== Estatus.ACTIVO) {
      return res.status(401).json({ error: "Usuario inactivo o baja" });
    }

    const session = await prisma.refreshToken.findUnique({
      where: { id: decoded.sid },
      select: {
        id: true,
        usuarioId: true,
        revoked: true,
      revokedAt: true,
      expiresAt: true,
      },
    });

    if (
      !session ||
      session.usuarioId !== usuario.id ||
      session.revoked ||
      session.revokedAt ||
      (session.expiresAt && session.expiresAt <= new Date())
    ) {
      return res.status(401).json({ error: "Sesión inválida o revocada" });
    }

    req.user = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      email: usuario.email || "",
      rol: usuario.rol, 
      departamentoId: usuario.departamentoId,
      sessionId: session.id,
    };

    next();
  } catch (error) {
    if (
      error instanceof Error &&
      !["JsonWebTokenError", "TokenExpiredError", "NotBeforeError"].includes(error.name)
    ) {
      return res.status(503).json({ error: "Servicio de autenticación temporalmente no disponible" });
    }

    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};
