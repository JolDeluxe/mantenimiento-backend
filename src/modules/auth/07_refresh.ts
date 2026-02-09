import { type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { env } from "../../env";
import { generateAccessToken } from "./utils/tokenGenerator";
import type { TokenPayload } from "./types";

export const refreshSession = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ status: "error", message: "Token de refresco requerido" });
    }

    // a) Verificar validez del JWT (firma y expiración física)
    const decoded = jwt.verify(refreshToken, env.JWT_SECRET) as { id: number };

    // b) Buscar tokens activos del usuario en BD
    const storedTokens = await prisma.refreshToken.findMany({
      where: { 
        usuarioId: decoded.id, 
        revoked: false,
        expiresAt: { gt: new Date() } // Que no haya expirado en BD
      }
    });

    // c) Validar el hash para encontrar el token exacto
    let tokenValido = null;
    for (const token of storedTokens) {
      const match = await bcrypt.compare(refreshToken, token.hashedToken);
      if (match) {
        tokenValido = token;
        break;
      }
    }

    if (!tokenValido) {
      return res.status(401).json({ status: "error", message: "Sesión inválida o expirada" });
    }

    // d) Obtener datos actualizados del usuario para el nuevo payload
    const usuario = await prisma.usuario.findUnique({
      where: { id: decoded.id },
      select: { 
        id: true, 
        username: true, 
        email: true, 
        rol: true, 
        nombre: true, 
        departamentoId: true,
        estado: true 
      }
    });

    if (!usuario || usuario.estado !== "ACTIVO") {
      return res.status(401).json({ status: "error", message: "Usuario no disponible" });
    }

    // e) Generar nuevo Access Token
    const payload: TokenPayload = {
      id: usuario.id,
      username: usuario.username,
      email: usuario.email,
      rol: usuario.rol,
      nombre: usuario.nombre,
      departamentoId: usuario.departamentoId
    };

    const accessToken = generateAccessToken(payload);

    return res.status(200).json({
      status: "success",
      accessToken
    });

  } catch (error) {
    return res.status(401).json({ status: "error", message: "Sesión caducada" });
  }
};