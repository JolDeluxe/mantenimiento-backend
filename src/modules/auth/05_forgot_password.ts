import type { Request, Response } from "express";
import { prisma } from "../../db";
import crypto from "crypto";
import { enviarCorreoRecuperacion } from "../../utils/mailer";
import { registrarError } from "../../utils/logger";
import type { ForgotPasswordInput } from "./zod";

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body as ForgotPasswordInput;

    const usuario = await prisma.usuario.findUnique({ where: { email } });

    if (!usuario) {
      await new Promise((resolve) => setTimeout(resolve, 500)); 
      return res.json({ message: "Si el correo existe en el sistema, recibirás las instrucciones." });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    await prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.deleteMany({ where: { usuarioId: usuario.id } });
      await tx.passwordResetToken.create({
        data: { token: resetToken, usuarioId: usuario.id, expiresAt },
      });
    });

    const enviado = await enviarCorreoRecuperacion(email, resetToken);

    if (!enviado) {
       await prisma.passwordResetToken.deleteMany({ where: { token: resetToken } });
       return res.status(500).json({ error: "Error técnico al enviar el correo. Intenta más tarde." });
    }

    return res.json({ message: "Si el correo existe en el sistema, recibirás las instrucciones." });

  } catch (error) {
    await registrarError("AUTH_FORGOT_PASS", 0, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};