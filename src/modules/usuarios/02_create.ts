import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import type { CreateUsuarioInput } from "./zod";
import { generarUsername } from "./utils/userGenerator";
import { validarReglasCreacion } from "./helper"; 
import { registrarAccion, registrarError } from "../../utils/logger";
import { uploadUserProfileImage } from "../../utils/cloudinary";

export const crearUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!; 
    const { nombre, email, password, rol, cargo, departamentoId, username, telefono } = req.body as CreateUsuarioInput;
    
    let nombreDepartamentoObjetivo: string | null = null;

    if (departamentoId) {
      const departamento = await prisma.departamento.findUnique({ where: { id: departamentoId } });
      if (!departamento) return res.status(400).json({ error: "El departamento seleccionado no existe." });
      nombreDepartamentoObjetivo = departamento.nombre;
    }

    try {
      validarReglasCreacion(
        usuarioSolicitante,
        { rol, departamentoId: departamentoId ?? null },
        nombreDepartamentoObjetivo
      );
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    if (email) {
      const emailExiste = await prisma.usuario.findUnique({ where: { email } });
      if (emailExiste) return res.status(400).json({ error: "El correo ya está registrado." });
    }

    if (rol !== Rol.TECNICO && !email) {
       return res.status(400).json({ error: "Ese correo no es válido para este rol (Requerido)." });
    }

    let usernameFinal = "";
    if (username) {
      const existe = await prisma.usuario.findUnique({ where: { username } });
      if (existe) return res.status(400).json({ error: `El usuario '${username}' ya existe.` });
      usernameFinal = username;
    } else {
      const candidatos = generarUsername(nombre);
      let encontrado = false;
      for (const candidato of candidatos) {
        const ocupado = await prisma.usuario.findUnique({ where: { username: candidato } });
        if (!ocupado) { usernameFinal = candidato; encontrado = true; break; }
      }
      if (!encontrado) usernameFinal = `${candidatos[0]}${Math.floor(Math.random() * 1000)}`;
    }

    let imagenUrl: string | undefined = undefined;
    
    if (req.file) {
        try {
            imagenUrl = await uploadUserProfileImage(req.file.buffer);
        } catch (uploadError) {
            return res.status(500).json({ error: "Error al subir la imagen." });
        }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre, username: usernameFinal, email, password: hashedPassword,
        rol: rol as Rol, cargo, imagen: imagenUrl, telefono, departamentoId
      },
      select: { id: true, username: true, email: true, rol: true, nombre: true, imagen: true }
    });

    await registrarAccion('CREAR_USUARIO', usuarioSolicitante.id, `Creó usuario: ${usernameFinal} (${rol})`);

    return res.status(201).json({ message: "Usuario creado correctamente", data: nuevoUsuario });

  } catch (error) {
    await registrarError('CREAR_USUARIO_ERROR', req.user?.id || null, error);
    return res.status(500).json({ error: "Error al crear usuario" });
  }
};