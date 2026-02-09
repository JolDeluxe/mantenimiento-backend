import type { Request, Response } from "express";
import { prisma } from "../../db";
import bcrypt from "bcryptjs";
import { registrarError } from "../../utils/logger";
import { resetPasswordSchema } from "./zod";

export const resetPassword = async (req: Request, res: Response) => {
  try {
    // 1. Validar datos (Token y Password nueva)
    const result = resetPasswordSchema.safeParse(req);

    if (!result.success) {
      return res.status(400).json({ 
        error: "Datos inválidos", 
        details: result.error.issues 
      });
    }

    const { token, password } = result.data.body;

    // 2. Buscar el token en la BD e incluir al usuario relacionado
    const resetTokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { usuario: true },
    });

    // 3. Validar existencia y expiración
    if (!resetTokenRecord) {
      return res.status(400).json({ error: "Token inválido o no existe." });
    }

    if (new Date() > resetTokenRecord.expiresAt) {
      // Si venció, lo borramos para limpiar la BD
      await prisma.passwordResetToken.delete({ where: { id: resetTokenRecord.id } });
      return res.status(400).json({ error: "El enlace ha expirado. Solicita uno nuevo." });
    }

    // 4. Encriptar la nueva contraseña
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 5. Transacción: Actualizar usuario y borrar token usado
    await prisma.$transaction(async (tx) => {
      // Actualizar password del usuario
      await tx.usuario.update({
        where: { id: resetTokenRecord.usuarioId },
        data: { 
          password: hashedPassword,
          // Si tenía bandera de "cambiar password obligatorio", se la quitamos
          mustChangePassword: false 
        },
      });

      // Borrar el token para que no se pueda reusar
      await tx.passwordResetToken.delete({
        where: { id: resetTokenRecord.id },
      });
    });

    return res.json({ message: "Contraseña restablecida con éxito. Ya puedes iniciar sesión." });

  } catch (error) {
    await registrarError("AUTH_RESET_PASS", 0, error);
    return res.status(500).json({ error: "Error al restablecer contraseña" });
  }
};