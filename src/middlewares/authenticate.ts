import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../db";
import { env } from "../env";
import { Estatus } from "@prisma/client";
import type { TokenPayload } from "../modules/auth/types";

export const authenticate = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token no proporcionado o formato incorrecto" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Token vacío o mal formado" });
  }

  try {
    const decoded = jwt.verify(
      token,
      env.JWT_SECRET as string 
    ) as unknown as TokenPayload;

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

    req.user = {
      id: usuario.id,
      username: usuario.username,
      nombre: usuario.nombre,
      email: usuario.email || "",
      rol: usuario.rol, 
      departamentoId: usuario.departamentoId
    };

    next();
  } catch (error) {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};