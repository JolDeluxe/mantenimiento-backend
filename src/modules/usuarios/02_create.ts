import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { createUsuarioSchema } from "./zod"; // Importamos el Schema, no solo el tipo
import { generarUsername } from "../../utils/userGenerator";
import { validarReglasCreacion } from "./helper"; 
import { registrarAccion, registrarError } from "../../utils/logger";
import { uploadUserProfileImage } from "../../utils/cloudinary"; // <--- IMPORTANTE

export const crearUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!; 

    // 1. LIMPIEZA DE DATOS (FormData convierte todo a string)
    // Hacemos una copia del body para arreglar los tipos
    const rawBody = { ...req.body };

    // Convertir "5" a 5, y "null" a null real
    if (rawBody.departamentoId) {
        if (rawBody.departamentoId === "null" || rawBody.departamentoId === "") {
            rawBody.departamentoId = null;
        } else {
            rawBody.departamentoId = Number(rawBody.departamentoId);
        }
    }

    // Convertir email "null" o vacío a null real
    if (rawBody.email === "null" || rawBody.email === "") {
        rawBody.email = null;
    }

    // 2. VALIDACIÓN ZOD (Ahora que los tipos son correctos)
    const result = createUsuarioSchema.shape.body.safeParse(rawBody);

    if (!result.success) {
        return res.status(400).json({ error: "Datos inválidos", details: result.error.issues });
    }

    const { 
      nombre, email, password, rol, cargo, departamentoId, 
      username, telefono 
    } = result.data; // Usamos los datos limpios y validados
    
    // 3. REGLAS DE NEGOCIO
    let nombreDepartamentoObjetivo: string | null = null;

    if (departamentoId) {
      const departamento = await prisma.departamento.findUnique({
        where: { id: departamentoId }
      });

      if (!departamento) {
        return res.status(400).json({ error: "El departamento seleccionado no existe." });
      }
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

    // Validar Email único
    const emailLimpio = email?.trim() || null;
    if (emailLimpio) {
      const emailExiste = await prisma.usuario.findUnique({
        where: { email: emailLimpio }
      });
      if (emailExiste) {
        return res.status(400).json({ error: "El correo ya está registrado." });
      }
    }

    if (rol !== Rol.TECNICO && !emailLimpio) {
       return res.status(400).json({ error: "Ese correo no es válido para este rol (Requerido)." });
    }

    // Generar Username
    let usernameFinal = "";
    if (username && username.trim() !== "") {
      const existe = await prisma.usuario.findUnique({ where: { username } });
      if (existe) {
        return res.status(400).json({ error: `El usuario '${username}' ya existe.` });
      }
      usernameFinal = username;
    } else {
      const candidatos = generarUsername(nombre);
      let encontrado = false;
      for (const candidato of candidatos) {
        const ocupado = await prisma.usuario.findUnique({ where: { username: candidato } });
        if (!ocupado) { usernameFinal = candidato; encontrado = true; break; }
      }
      // Fallback simple si todo está ocupado
      if (!encontrado) usernameFinal = `${candidatos[0]}${Math.floor(Math.random() * 1000)}`;
    }

    // 4. SUBIR IMAGEN (Si existe en la petición)
    let imagenUrl: string | undefined = undefined;
    
    // req.file viene gracias a Multer (el middleware)
    if (req.file) {
        try {
            imagenUrl = await uploadUserProfileImage(req.file.buffer);
        } catch (uploadError) {
            console.error("Error Cloudinary:", uploadError);
            return res.status(500).json({ error: "Error al subir la imagen." });
        }
    }

    // 5. GUARDAR EN BD
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const nuevoUsuario = await prisma.usuario.create({
      data: {
        nombre,
        username: usernameFinal, 
        email: emailLimpio,
        password: hashedPassword,
        rol: rol as Rol,
        cargo,
        imagen: imagenUrl,
        telefono,
        departamentoId
      },
      select: {
        id: true, username: true, email: true, rol: true, nombre: true, imagen: true
      }
    });

    await registrarAccion(
      'CREAR_USUARIO', 
      usuarioSolicitante.id, 
      `Creó usuario: ${usernameFinal} (${rol})`
    );

    res.status(201).json({ 
      message: "Usuario creado correctamente", 
      data: nuevoUsuario 
    });

  } catch (error) {
    await registrarError('CREAR_USUARIO_ERROR', req.user?.id || null, error);
    res.status(500).json({ error: "Error al crear usuario" });
  }
};