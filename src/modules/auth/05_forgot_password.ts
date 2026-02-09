import type { Request, Response } from "express";
import { prisma } from "../../db";
import crypto from "crypto";
import { enviarCorreoRecuperacion } from "../../utils/mailer";
import { registrarError } from "../../utils/logger";
import { forgotPasswordSchema } from "./zod";

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    // Validar los datos de entrada (Zod)
    const result = forgotPasswordSchema.safeParse(req);

    if (!result.success) {
      return res.status(400).json({ 
        error: "Datos inválidos", 
        details: result.error.issues 
      });
    }

    const { email } = result.data.body;

    // Buscar si el usuario existe
    const usuario = await prisma.usuario.findUnique({
      where: { email },
    });

    // SEGURIDAD: Si no existe, NO le decimos al hacker "el correo no existe".
    // Respondemos OK para que no puedan minar nuestra base de datos probando correos.
    if (!usuario) {
      // Pequeño delay artificial para simular procesamiento y evitar "Timing Attacks"
      await new Promise((resolve) => setTimeout(resolve, 500)); 
      return res.json({ 
        message: "Si el correo existe en el sistema, recibirás las instrucciones." 
      });
    }

    // Generar un Token Seguro (Hexadecimal)
    const resetToken = crypto.randomBytes(32).toString("hex");
    
    // El token expira en 1 hora (tiempo actual + 60 min * 60 seg * 1000 ms)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); 

    // Guardar en Base de Datos (Transacción)
    // Usamos transacción para asegurar que se borren tokens viejos antes de crear el nuevo
    await prisma.$transaction(async (tx) => {
      // Limpiar intentos anteriores de este usuario
      await tx.passwordResetToken.deleteMany({
        where: { usuarioId: usuario.id }
      });

      // Guardar el nuevo token
      await tx.passwordResetToken.create({
        data: {
          token: resetToken,
          usuarioId: usuario.id,
          expiresAt,
        },
      });
    });

    // Enviar el Correo
    // Usamos la utilidad que acabamos de configurar (Ethereal o Gmail/Outlook)
    const enviado = await enviarCorreoRecuperacion(email, resetToken);

    if (!enviado) {
       // Si falló el envío del correo (error SMTP), borramos el token generado
       // para no dejar "basura" en la BD que el usuario nunca recibió.
       await prisma.passwordResetToken.deleteMany({ where: { token: resetToken } });
       return res.status(500).json({ error: "Error técnico al enviar el correo. Intenta más tarde." });
    }

    // Respuesta Exitosa
    return res.json({ 
      message: "Si el correo existe en el sistema, recibirás las instrucciones." 
    });

  } catch (error) {
    // Registrar error interno sin dar detalles al cliente
    await registrarError("AUTH_FORGOT_PASS", 0, error);
    console.error(error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};