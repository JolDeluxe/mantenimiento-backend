import { type Request, type Response } from "express";
import { prisma } from "../../db";
import { registrarError } from "../../utils/logger"; // <--- AGREGADO

export const getProfile = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id; // Extraemos aquí para tenerlo disponible en el catch

  try {
    if (!usuarioId) {
        return res.status(401).json({ status: "error", message: "Token inválido o expirado" });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: {
        id: true,
        nombre: true,
        username: true,
        email: true,
        rol: true,
        cargo: true,
        imagen: true,
        departamento: {
            select: {
                id: true,
                nombre: true
            }
        },
        createdAt: true
      }
    });

    if (!usuario) {
      return res.status(404).json({ status: "error", message: "Usuario no encontrado" });
    }

    return res.json({
      status: "success",
      data: usuario
    });

  } catch (error) {
    // LOG DE ERROR DEL SISTEMA
    await registrarError('GET_PROFILE_ERROR', usuarioId || null, error);
    
    return res.status(500).json({ status: "error", message: "Error interno al obtener perfil" });
  }
};