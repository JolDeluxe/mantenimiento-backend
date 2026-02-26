import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client"; 
import type { PatchUsuarioInput, PatchUsuarioParams } from "./zod";
import { validarReglasDesactivacion } from "./helper"; 
import { registrarAccion, registrarError } from "../../utils/logger";

export const changeStatusUsuario = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { id } = req.params as unknown as PatchUsuarioParams;
    const { estado } = req.body as PatchUsuarioInput;

    const usuarioObjetivo = await prisma.usuario.findUnique({ where: { id } });

    if (!usuarioObjetivo) return res.status(404).json({ error: "Usuario no encontrado" });

    try {
      validarReglasDesactivacion(usuarioSolicitante, usuarioObjetivo);
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const usuarioActualizado = await prisma.usuario.update({
      where: { id },
      data: { estado: estado as Estatus },
      select: { id: true, nombre: true, username: true, rol: true, estado: true, updatedAt: true }
    });

    await registrarAccion(
      'CAMBIO_ESTADO_USUARIO',
      usuarioSolicitante.id,
      `Cambió estado a ${estado} para usuario ID: ${id} (${usuarioObjetivo.username})`
    );

    return res.json({ message: `El usuario ha sido marcado como ${estado}`, data: usuarioActualizado });

  } catch (error) {
    await registrarError('PATCH_USUARIO_ERROR', req.user?.id || null, error);
    return res.status(500).json({ error: "No se pudo actualizar el estatus" });
  }
};