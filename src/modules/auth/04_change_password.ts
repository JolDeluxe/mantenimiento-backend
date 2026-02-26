import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { registrarAccion, registrarError } from "../../utils/logger"; 
import type { ChangePasswordInput } from "./zod";

export const changePassword = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id; 

  try {
    if (!usuarioId) return res.status(401).json({ error: "No autenticado" });
    
    const { currentPassword, newPassword } = req.body as ChangePasswordInput;

    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    const isMatch = await bcrypt.compare(currentPassword, usuario.password);
    if (!isMatch) {
        await registrarAccion('CAMBIO_PASS_FALLIDO', usuarioId, 'Contraseña actual incorrecta');
        return res.status(400).json({ status: "error", message: "La contraseña actual es incorrecta." });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.usuario.update({
        where: { id: usuarioId },
        data: { password: hashedPassword }
    });

    await registrarAccion('CAMBIO_PASS_EXITOSO', usuarioId, 'El usuario cambió su contraseña');

    return res.json({ status: "success", message: "Contraseña actualizada correctamente." });

  } catch (error) {
    await registrarError('CHANGE_PASSWORD_SYSTEM_ERROR', usuarioId || null, error);
    return res.status(500).json({ status: "error", message: "Error interno" });
  }
};