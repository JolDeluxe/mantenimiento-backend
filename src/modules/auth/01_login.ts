import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db"; 
import { Estatus } from "@prisma/client"; 
import { registrarAccion, registrarError } from "../../utils/logger";
import type { LoginInput } from "./zod";
import type { TokenPayload } from "./types";
import { createPersistentSession, issueAccessForSession, setAccessCookie, setRefreshCookie } from "./session";

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password }: LoginInput = req.body;

    const usuario = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: identifier },
          { username: identifier }
        ]
      },
    });

    if (!usuario) {
      await registrarAccion('LOGIN_FALLIDO', null, `Usuario no encontrado: ${identifier}`);
      return res.status(401).json({ status: "error", message: "Credenciales inválidas" });
    }

    if (usuario.estado !== Estatus.ACTIVO) {
      await registrarAccion('LOGIN_BLOQUEADO', usuario.id, 'Intento de acceso usuario inactivo');
      return res.status(403).json({ 
        status: "error", 
        message: "Usuario desactivado o suspendido. Contacte a soporte." 
      });
    }

    const isMatch = await bcrypt.compare(password, usuario.password);

    if (!isMatch) {
      await registrarAccion('LOGIN_FALLIDO', usuario.id, 'Contraseña incorrecta');
      return res.status(401).json({ status: "error", message: "Credenciales inválidas" });
    }

    const payload: TokenPayload = {
      id: usuario.id,
      username: usuario.username, 
      email: usuario.email, 
      rol: usuario.rol,
      nombre: usuario.nombre,
      departamentoId: usuario.departamentoId 
    };

    const session = await createPersistentSession(req, usuario.id);
    const accessToken = issueAccessForSession(payload, session.sessionId);

    setAccessCookie(req, res, accessToken);
    setRefreshCookie(req, res, session.refreshToken);

    await registrarAccion('LOGIN_EXITOSO', usuario.id, 'Inicio de sesión exitoso');

    return res.status(200).json({
      status: "success",
      // LEGACY COMPATIBILITY: los frontends nuevos ignoran estos tokens.
      // Se retiran cuando ya no existan clientes cacheados con Bearer/localStorage.
      accessToken,
      refreshToken: session.refreshToken,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        departamentoId: usuario.departamentoId,
        email: usuario.email || undefined,
        mustChangePassword: usuario.mustChangePassword
      },
    });

  } catch (error) {
    await registrarError('LOGIN_SYSTEM_ERROR', null, error);
    return res.status(500).json({ status: "error", message: "Error interno del servidor" });
  }
};
