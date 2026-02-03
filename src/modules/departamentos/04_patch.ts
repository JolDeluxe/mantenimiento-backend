import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client";
import { z } from "zod";
import type { PatchDepartamentoInput } from "./types";
import { registrarAccion, registrarError } from "../../utils/logger"; 
import { validarProteccionDepartamento } from "./helper"; 

export const patchDepartamentoEstado = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id || null;

  try {
    // Verificación de Rol
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params;
    const departamentoId = Number(id);

    if (isNaN(departamentoId)) {
      return res.status(400).json({ error: "ID de departamento inválido" });
    }

    const { estado } = req.body as PatchDepartamentoInput;

    // Verificar existencia
    const existe = await prisma.departamento.findUnique({ 
      where: { id: departamentoId } 
    });

    if (!existe) {
      return res.status(404).json({ error: "Departamento no encontrado" });
    }

    // --- PROTECCIÓN DE MANTENIMIENTO ---
    try {
      validarProteccionDepartamento(existe, { estado });
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    // CORRECCIÓN: Casting de estado
    const nuevoEstado = estado as Estatus;

    if (nuevoEstado === Estatus.INACTIVO) {
      const usuariosActivos = await prisma.usuario.count({
        where: {
          departamentoId: departamentoId,
          estado: Estatus.ACTIVO
        }
      });

      if (usuariosActivos > 0) {
        return res.status(400).json({ 
          error: `No puedes desactivar el departamento. Tiene usuarios activos asignados.` 
        });
      }
    }

    // Actualizar
    const actualizado = await prisma.departamento.update({
      where: { id: departamentoId },
      data: { estado: nuevoEstado },
    });

    // LOG DE ÉXITO
    await registrarAccion(
      'CAMBIO_ESTADO_DEPTO', 
      usuarioId, 
      `Departamento ID: ${departamentoId} cambiado a ${nuevoEstado}`
    );

    return res.json({
      message: `Departamento marcado como ${nuevoEstado}`,
      data: actualizado
    });

  } catch (error: any) {
    // LOG DE ERROR
    if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Datos inválidos", details: error.issues });
    }
    await registrarError('PATCH_DEPARTAMENTO', usuarioId, error);
    return res.status(500).json({ error: "Error interno al cambiar el estado" });
  }
};