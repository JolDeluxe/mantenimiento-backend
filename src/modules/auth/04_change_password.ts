import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { z } from "zod";
import { registrarAccion, registrarError } from "../../utils/logger"; 

const changePasswordSchema = z.object({
    currentPassword: z.string().min(1, "La contraseña actual es requerida"),
    newPassword: z.string().min(6, "La nueva contraseña debe tener al menos 6 caracteres")
});

export const changePassword = async (req: Request, res: Response) => {
  // Sacamos usuarioId fuera del try para que sea accesible en el catch (si req.user existe)
  const usuarioId = req.user?.id; 

  try {
    if (!usuarioId) return res.status(401).json({ error: "No autenticado" });
    
    // Validar inputs
    const validation = changePasswordSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ status: "error", errors: validation.error.format() });
    }

    const { currentPassword, newPassword } = validation.data;

    // Buscar usuario para obtener el hash actual
    const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado" });

    // Verificar contraseña actual
    const isMatch = await bcrypt.compare(currentPassword, usuario.password);
    if (!isMatch) {
        await registrarAccion('CAMBIO_PASS_FALLIDO', usuarioId, 'Contraseña actual incorrecta');
        return res.status(400).json({ status: "error", message: "La contraseña actual es incorrecta." });
    }

    // Encriptar nueva y guardar
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.usuario.update({
        where: { id: usuarioId },
        data: { password: hashedPassword }
    });

    await registrarAccion('CAMBIO_PASS_EXITOSO', usuarioId, 'El usuario cambió su contraseña');

    return res.json({ status: "success", message: "Contraseña actualizada correctamente." });

  } catch (error) {
    // LOG DE ERROR CRITICO
    await registrarError('CHANGE_PASSWORD_SYSTEM_ERROR', usuarioId || null, error);
    
    return res.status(500).json({ status: "error", message: "Error interno" });
  }
};