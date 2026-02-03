import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { updateUsuarioSchema } from "./zod";
import { validarReglasEdicion } from "./helper";
import { registrarAccion, registrarError } from "../../utils/logger";
import { uploadUserProfileImage, deleteImageByUrl } from "../../utils/cloudinary"; 

export const updateUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { id } = req.params;
    const usuarioIdObjetivo = Number(id);

    if (isNaN(usuarioIdObjetivo)) {
      return res.status(400).json({ error: "ID de usuario inválido" });
    }

    const usuarioActual = await prisma.usuario.findUnique({
      where: { id: usuarioIdObjetivo }
    });

    if (!usuarioActual) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const rawBody = { ...req.body };
    
    if (rawBody.departamentoId !== undefined) {
         if (rawBody.departamentoId === "null" || rawBody.departamentoId === "") {
             rawBody.departamentoId = null;
         } else {
             rawBody.departamentoId = Number(rawBody.departamentoId);
         }
    }
    
    if (rawBody.email === "" || rawBody.email === "null") rawBody.email = null;

    const result = updateUsuarioSchema.safeParse(rawBody);
    
    if (!result.success) {
        return res.status(400).json({ error: "Datos inválidos", details: result.error.issues });
    }
    const datos = result.data;

    try {
      validarReglasEdicion(usuarioSolicitante, usuarioActual, datos);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const dataToUpdate: any = {};

    if (req.file) {
        try {
            const nuevaUrl = await uploadUserProfileImage(req.file.buffer);
            dataToUpdate.imagen = nuevaUrl;

            // B) Si tenía imagen anterior, borrarla de Cloudinary para ahorrar espacio
            if (usuarioActual.imagen) {
                // No usamos await para no detener la respuesta al usuario
                deleteImageByUrl(usuarioActual.imagen).catch(e => console.error("Error borrando img vieja", e));
            }
        } catch (e) {
            return res.status(500).json({ error: "Error al procesar la imagen." });
        }
    }

    if (datos.email !== undefined) {
      const emailLimpio = datos.email?.trim() || null;
      const rolFinal = datos.rol || usuarioActual.rol;

      if (rolFinal !== Rol.TECNICO && !emailLimpio) {
          return res.status(400).json({ error: "El correo es obligatorio." });
      }

      if (emailLimpio && emailLimpio !== usuarioActual.email) {
        const emailOcupado = await prisma.usuario.findFirst({
          where: {
            email: emailLimpio,
            id: { not: usuarioIdObjetivo }
          }
        });
        if (emailOcupado) {
          return res.status(400).json({ error: "El correo ya está en uso por otro usuario." });
        }
      }
      dataToUpdate.email = emailLimpio;
    }

    if (datos.username) {
        const usernameLimpio = datos.username.trim();
        if (usernameLimpio !== usuarioActual.username) {
            const userOcupado = await prisma.usuario.findUnique({
                where: { username: usernameLimpio }
            });
            if (userOcupado) {
                return res.status(400).json({ error: "El nombre de usuario ya existe." });
            }
            dataToUpdate.username = usernameLimpio;
        }
    }

    if (datos.password && datos.password.trim() !== "") {
      dataToUpdate.password = await bcrypt.hash(datos.password, 10);
    }
    if (datos.nombre) dataToUpdate.nombre = datos.nombre;
    if (datos.rol) dataToUpdate.rol = datos.rol as Rol;
    if (datos.cargo) dataToUpdate.cargo = datos.cargo;
    
    if (datos.imagen === null) dataToUpdate.imagen = null; 

    if (datos.telefono !== undefined) dataToUpdate.telefono = datos.telefono; 
    
    if (datos.departamentoId !== undefined) {
        if (datos.departamentoId === null) {
             dataToUpdate.departamentoId = null;
        } else {
             const deptoExiste = await prisma.departamento.findUnique({
                 where: { id: datos.departamentoId }
             });
             
             if (!deptoExiste) {
                 return res.status(400).json({ error: "El departamento especificado no existe." });
             }
             dataToUpdate.departamentoId = datos.departamentoId;
        }
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id: usuarioIdObjetivo },
      data: dataToUpdate,
      select: {
        id: true,
        nombre: true,
        username: true,
        email: true,
        rol: true,
        cargo: true,
        estado: true,
        imagen: true,
        telefono: true,
        departamento: {
            select: { nombre: true, id: true, planta: true }
        }
      }
    });

    await registrarAccion(
      'EDITAR_USUARIO', 
      usuarioSolicitante.id, 
      `Editó usuario ID: ${usuarioIdObjetivo}`
    );

    res.json({ 
      message: "Usuario actualizado correctamente", 
      data: usuarioActualizado 
    });

  } catch (error) {
    await registrarError('EDITAR_USUARIO_ERROR', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno al editar el usuario" });
  }
};