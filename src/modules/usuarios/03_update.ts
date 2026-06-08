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

    let nombreDepartamentoObjetivo: string | null = null;
    const deptoIdFinal = datos.departamentoId !== undefined ? datos.departamentoId : usuarioActual.departamentoId;
    if (deptoIdFinal) {
      const departamento = await prisma.departamento.findUnique({ where: { id: deptoIdFinal } });
      nombreDepartamentoObjetivo = departamento ? departamento.nombre : null;
    }

    try {
      validarReglasEdicion(usuarioSolicitante, usuarioActual, datos, nombreDepartamentoObjetivo);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const dataToUpdate: any = {};

    // 1. Manejo de subida de nueva imagen
    if (req.file) {
        try {
            dataToUpdate.imagen = await uploadUserProfileImage(req.file.buffer);
            // Destruir imagen anterior en Cloudinary
            if (usuarioActual.imagen) {
                deleteImageByUrl(usuarioActual.imagen).catch(e => console.error("Error borrando img vieja al subir nueva", e));
            }
        } catch (e) {
            return res.status(500).json({ error: "Error al procesar la imagen." });
        }
    }

    // 2. Manejo de eliminación explícita de imagen
    if (datos.imagen === null) {
      dataToUpdate.imagen = null;
      // Destruir imagen huérfana en Cloudinary
      if (usuarioActual.imagen) {
          deleteImageByUrl(usuarioActual.imagen).catch(e => console.error("Error borrando img huérfana en Cloudinary", e));
      }
    }

    // 3. Reglas de negocio: Correo
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

    // 4. Reglas de negocio: Username
    if (datos.username && datos.username !== usuarioActual.username) {
        const userOcupado = await prisma.usuario.findUnique({ where: { username: datos.username } });
        if (userOcupado) return res.status(400).json({ error: "El nombre de usuario ya existe." });
        dataToUpdate.username = datos.username;
    }

    // 5. Cambio de Contraseña
    if (datos.password && datos.password.trim() !== "") {
      dataToUpdate.password = await bcrypt.hash(datos.password, 10);
    }

    // 6. Campos planos opcionales
    if (datos.nombre !== undefined) dataToUpdate.nombre = datos.nombre;
    if (datos.rol !== undefined) dataToUpdate.rol = datos.rol as Rol;
    if (datos.cargo !== undefined) dataToUpdate.cargo = datos.cargo;
    if (datos.telefono !== undefined) dataToUpdate.telefono = datos.telefono; 
    if (datos.estado !== undefined) dataToUpdate.estado = datos.estado;
    
    // 7. Reglas de negocio: Departamento
    if (datos.departamentoId !== undefined) {
        if (datos.departamentoId === null) {
             dataToUpdate.departamentoId = null;
        } else {
             const deptoExiste = await prisma.departamento.findUnique({ where: { id: datos.departamentoId } });
             if (!deptoExiste) return res.status(400).json({ error: "El departamento especificado no existe." });
             dataToUpdate.departamentoId = datos.departamentoId;
        }
    }

    // 8. Transacción final
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