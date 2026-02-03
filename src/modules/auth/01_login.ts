import { type Request, type Response } from "express";
import jwt, { type SignOptions } from "jsonwebtoken"; 
import bcrypt from "bcryptjs";
import { prisma } from "../../db"; 
import { env } from "../../env"; 
import { type LoginInput } from "./zod";
import { type TokenPayload } from "./types";
import { Estatus } from "@prisma/client"; 
import { registrarAccion, registrarError } from "../../utils/logger";

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
      // LOG DE LOGIN FALLIDO (Usuario no encontrado)
      await registrarAccion('LOGIN_FALLIDO', null, `Usuario no encontrado: ${identifier}`);
      return res.status(401).json({ 
        status: "error",
        message: "Credenciales inválidas" 
      });
    }

    if (usuario.estado !== Estatus.ACTIVO) {
      // LOG DE LOGIN BLOQUEADO (Usuario inactivo)
      await registrarAccion('LOGIN_BLOQUEADO', usuario.id, 'Intento de acceso usuario inactivo');
      return res.status(403).json({ 
        status: "error",
        message: "Usuario desactivado o suspendido. Contacte a soporte." 
      });
    }

    const isMatch = await bcrypt.compare(password, usuario.password);

    if (!isMatch) {
      // LOG DE LOGIN FALLIDO (Contraseña incorrecta)
      await registrarAccion('LOGIN_FALLIDO', usuario.id, 'Contraseña incorrecta');
      return res.status(401).json({ 
        status: "error",
        message: "Credenciales inválidas" 
      });
    }

    const payload: TokenPayload = {
      id: usuario.id,
      username: usuario.username, 
      email: usuario.email, 
      rol: usuario.rol,
      nombre: usuario.nombre,
      departamentoId: usuario.departamentoId 
    };

    const token = jwt.sign(payload, env.JWT_SECRET, { 
      expiresIn: env.JWT_EXPIRES as string | number 
    } as SignOptions);

    // LOG DE INICIO DE SESION EXITOSO
    await registrarAccion('LOGIN_EXITOSO', usuario.id, 'Inicio de sesión exitoso');

    return res.status(200).json({
      status: "success",
      token,
      user: {
        id: usuario.id,
        nombre: usuario.nombre,
        rol: usuario.rol,
        departamentoId: usuario.departamentoId,
        email: usuario.email || undefined 
      },
    });

  } catch (error) {
    // LOG DE ERROR DEL SISTEMA (CRASH)
    await registrarError('LOGIN_SYSTEM_ERROR', null, error);
    return res.status(500).json({ 
      status: "error",
      message: "Error interno del servidor" 
    });
  }
};