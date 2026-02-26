import type { Request, Response } from "express";
import { prisma } from "../../db";
import bcrypt from "bcryptjs";
import { registrarError } from "../../utils/logger";
import type { ResetPasswordInput } from "./zod";

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body as ResetPasswordInput;

    const resetTokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { usuario: true },
    });

    if (!resetTokenRecord) {
      return res.status(400).json({ error: "Token inválido o no existe." });
    }

    if (new Date() > resetTokenRecord.expiresAt) {
      await prisma.passwordResetToken.delete({ where: { id: resetTokenRecord.id } });
      return res.status(400).json({ error: "El enlace ha expirado. Solicita uno nuevo." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id: resetTokenRecord.usuarioId },
        data: { password: hashedPassword, mustChangePassword: false },
      });

      await tx.passwordResetToken.delete({ where: { id: resetTokenRecord.id } });
    });

    return res.json({ message: "Contraseña restablecida con éxito. Ya puedes iniciar sesión." });

  } catch (error) {
    await registrarError("AUTH_RESET_PASS", 0, error);
    return res.status(500).json({ error: "Error al restablecer contraseña" });
  }
};