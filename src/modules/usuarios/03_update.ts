import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import type { UpdateUsuarioInput, UpdateUsuarioParams } from "./zod";
import { validarReglasEdicion } from "./helper";
import { registrarAccion, registrarError } from "../../utils/logger";
import { uploadUserProfileImage, deleteImageByUrl } from "../../utils/cloudinary"; 

export const updateUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { id } = req.params as unknown as UpdateUsuarioParams;
    const datos = req.body as UpdateUsuarioInput;

    const usuarioActual = await prisma.usuario.findUnique({ where: { id } });

    if (!usuarioActual) return res.status(404).json({ error: "Usuario no encontrado" });

    try {
      validarReglasEdicion(usuarioSolicitante, usuarioActual, datos);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const dataToUpdate: any = {};

    if (req.file) {
        try {
            dataToUpdate.imagen = await uploadUserProfileImage(req.file.buffer);
            if (usuarioActual.imagen) {
                deleteImageByUrl(usuarioActual.imagen).catch(e => console.error("Error borrando img vieja", e));
            }
        } catch (e) {
            return res.status(500).json({ error: "Error al procesar la imagen." });
        }
    }

    if (datos.email !== undefined) {
      const rolFinal = datos.rol || usuarioActual.rol;

      if (rolFinal !== Rol.TECNICO && !datos.email) {
          return res.status(400).json({ error: "El correo es obligatorio." });
      }

      if (datos.email && datos.email !== usuarioActual.email) {
        const emailOcupado = await prisma.usuario.findFirst({
          where: { email: datos.email, id: { not: id } }
        });
        if (emailOcupado) return res.status(400).json({ error: "El correo ya está en uso por otro usuario." });
      }
      dataToUpdate.email = datos.email;
    }

    if (datos.username && datos.username !== usuarioActual.username) {
        const userOcupado = await prisma.usuario.findUnique({ where: { username: datos.username } });
        if (userOcupado) return res.status(400).json({ error: "El nombre de usuario ya existe." });
        dataToUpdate.username = datos.username;
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
             const deptoExiste = await prisma.departamento.findUnique({ where: { id: datos.departamentoId } });
             if (!deptoExiste) return res.status(400).json({ error: "El departamento especificado no existe." });
             dataToUpdate.departamentoId = datos.departamentoId;
        }
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id },
      data: dataToUpdate,
      select: {
        id: true, nombre: true, username: true, email: true, rol: true, cargo: true, 
        estado: true, imagen: true, telefono: true,
        departamento: { select: { nombre: true, id: true, planta: true } }
      }
    });

    await registrarAccion('EDITAR_USUARIO', usuarioSolicitante.id, `Editó usuario ID: ${id}`);

    return res.json({ message: "Usuario actualizado correctamente", data: usuarioActualizado });

  } catch (error) {
    await registrarError('EDITAR_USUARIO_ERROR', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al editar el usuario" });
  }
};