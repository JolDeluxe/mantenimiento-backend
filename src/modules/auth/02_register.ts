import { type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { type RegisterInput } from "./zod";
import { generarUsername } from "../usuarios/utils/userGenerator";
import { registrarAccion, registrarError } from "../../utils/logger";
import { validarDepartamentoRegistro, calculateTokenExpirationDate } from "./helper";
import { generateAccessToken, generateRefreshToken } from "./utils/tokenGenerator";
import type { TokenPayload } from "./types";
import { env } from "../../env";

export const register = async (req: Request, res: Response) => {
  try {
    const { nombre, email, telefono, password, cargo, departamentoId, imagen } = req.body as RegisterInput & { telefono?: string | null };
    const emailLimpio = email && email.trim() !== "" ? email.trim() : null;
    const telefonoLimpio = telefono && telefono.trim() !== "" ? telefono.trim() : null;

    if (emailLimpio) {
      const existeEmail = await prisma.usuario.findUnique({
        where: { email: emailLimpio }
      });

      if (existeEmail) {
        return res.status(400).json({ status: "error", message: "El correo electrónico ya está registrado." });
      }
    }

    const validacionDepto = await validarDepartamentoRegistro(departamentoId);
    if (!validacionDepto.valido) {
      if (validacionDepto.esMantenimiento) {
        await registrarAccion('REGISTRO_BLOQUEADO', null, `Intento de registro en Mantenimiento: ${emailLimpio}`);
        return res.status(403).json({ status: "error", message: validacionDepto.message });
      }
      return res.status(400).json({ status: "error", message: validacionDepto.message });
    }

    const candidatos = generarUsername(nombre);
    let usernameFinal = "";
    let encontrado = false;

    for (const candidato of candidatos) {
      const ocupado = await prisma.usuario.findUnique({ where: { username: candidato } });
      if (!ocupado) { usernameFinal = candidato; encontrado = true; break; }
    }

    if (!encontrado) {
      let base = candidatos[0];
      let contador = 1;
      while (!encontrado) {
        const test = `${base}${contador}`;
        const ocupado = await prisma.usuario.findUnique({ where: { username: test } });
        if (!ocupado) { usernameFinal = test; encontrado = true; }
        else { contador++; }
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre, email: emailLimpio, telefono: telefonoLimpio, username: usernameFinal, password: hashedPassword,
        rol: Rol.CLIENTE_INTERNO, cargo, departamentoId, imagen
      },
      select: { id: true, nombre: true, username: true, email: true, rol: true, departamentoId: true, mustChangePassword: true }
    });

    await registrarAccion('REGISTRO_PUBLICO', nuevoUsuario.id, `Nuevo usuario registrado: ${usernameFinal}`);

    // Generar sesión exactamente igual que en 01_login.ts
    const payload: TokenPayload = {
      id: nuevoUsuario.id,
      username: nuevoUsuario.username,
      email: nuevoUsuario.email,
      rol: nuevoUsuario.rol,
      nombre: nuevoUsuario.nombre,
      departamentoId: nuevoUsuario.departamentoId
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken({ id: nuevoUsuario.id });

    const expiresAt = calculateTokenExpirationDate(env.JWT_REFRESH_EXPIRES);

    await prisma.refreshToken.create({
      data: {
        hashedToken: await bcrypt.hash(refreshToken, 10),
        usuarioId: nuevoUsuario.id,
        expiresAt
      }
    });

    return res.status(201).json({
      status: "success",
      message: "Registro exitoso.",
      accessToken,
      refreshToken,
      user: {
        id: nuevoUsuario.id,
        nombre: nuevoUsuario.nombre,
        username: nuevoUsuario.username,
        rol: nuevoUsuario.rol,
        departamentoId: nuevoUsuario.departamentoId,
        email: nuevoUsuario.email || undefined,
        mustChangePassword: nuevoUsuario.mustChangePassword
      }
    });

  } catch (error) {
    await registrarError('REGISTRO_SYSTEM_ERROR', null, error);
    return res.status(500).json({ status: "error", message: "Error interno al registrar usuario." });
  }
};