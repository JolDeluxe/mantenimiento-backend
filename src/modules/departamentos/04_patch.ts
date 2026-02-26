import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client";
import { registrarAccion, registrarError } from "../../utils/logger"; 
import { validarProteccionDepartamento } from "./helper"; 
import type { PatchDepartamentoInput, PatchDepartamentoParams } from "./zod";

export const patchDepartamentoEstado = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id || null;

  try {
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params as unknown as PatchDepartamentoParams;
    const { estado } = req.body as PatchDepartamentoInput;

    const existe = await prisma.departamento.findUnique({ where: { id } });

    if (!existe) {
      return res.status(404).json({ error: "Departamento no encontrado" });
    }

    try {
      validarProteccionDepartamento(existe, { estado });
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const nuevoEstado = estado as Estatus;

    if (nuevoEstado === Estatus.INACTIVO) {
      const usuariosActivos = await prisma.usuario.count({
        where: {
          departamentoId: id,
          estado: Estatus.ACTIVO
        }
      });

      if (usuariosActivos > 0) {
        return res.status(400).json({ error: `No puedes desactivar el departamento. Tiene usuarios activos asignados.` });
      }
    }

    const actualizado = await prisma.departamento.update({
      where: { id },
      data: { estado: nuevoEstado },
    });

    await registrarAccion('CAMBIO_ESTADO_DEPTO', usuarioId, `Departamento ID: ${id} cambiado a ${nuevoEstado}`);

    return res.json({
      message: `Departamento marcado como ${nuevoEstado}`,
      data: actualizado
    });

  } catch (error: any) {
    await registrarError('PATCH_DEPARTAMENTO', usuarioId, error);
    return res.status(500).json({ error: "Error interno al cambiar el estado" });
  }
};