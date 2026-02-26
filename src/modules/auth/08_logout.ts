import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import type { RefreshTokenInput } from "./zod";

export const logout = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as RefreshTokenInput;
    const usuarioId = req.user?.id;

    // Buscar los tokens activos del usuario
    const storedTokens = await prisma.refreshToken.findMany({
      where: { 
        usuarioId, 
        revoked: false 
      }
    });

    // Identificar el token exacto mediante el hash y marcarlo como revocado
    let tokenEncontradoId = null;
    for (const token of storedTokens) {
      const match = await bcrypt.compare(refreshToken, token.hashedToken);
      if (match) {
        tokenEncontradoId = token.id;
        break;
      }
    }

    if (tokenEncontradoId) {
      await prisma.refreshToken.update({
        where: { id: tokenEncontradoId },
        data: { revoked: true }
      });
    }

    // Registrar la salida en la bitácora
    if (usuarioId) {
      await registrarAccion('LOGOUT', usuarioId, 'Cierre de sesión exitoso');
    }

    return res.status(200).json({
      status: "success",
      message: "Sesión cerrada correctamente"
    });

  } catch (error) {
    return res.status(500).json({ status: "error", message: "Error al cerrar sesión" });
  }
};