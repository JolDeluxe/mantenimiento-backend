import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client"; 
import { z } from "zod";
import type { UpdateDepartamentoInput } from "./types";
import { registrarAccion, registrarError } from "../../utils/logger"; 
import { validarProteccionDepartamento } from "./helper"; 

export const updateDepartamento = async (req: Request, res: Response) => {
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

    const datos = req.body as UpdateDepartamentoInput; 

    // Verificar existencia
    const deptoActual = await prisma.departamento.findUnique({ 
      where: { id: departamentoId } 
    });

    if (!deptoActual) {
      return res.status(404).json({ error: "Departamento no encontrado" });
    }

    // --- PROTECCIÓN DE MANTENIMIENTO ---
    try {
      validarProteccionDepartamento(deptoActual, {
        nombre: datos.nombre,
        estado: datos.estado
      });
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const dataToUpdate: any = {};

    // Validar Nombre
    if (datos.nombre) {
      const nombreLimpio = datos.nombre.trim();
      
      if (nombreLimpio !== deptoActual.nombre) {
        const duplicado = await prisma.departamento.findUnique({ 
          where: { nombre: nombreLimpio } 
        });
        
        if (duplicado) {
          return res.status(400).json({ error: "Ya existe otro departamento con ese nombre" });
        }
        dataToUpdate.nombre = nombreLimpio;
      }
    }

    // Validar Campos Nuevos (Sin Casting, ahora son Strings directos)
    if (datos.planta) dataToUpdate.planta = datos.planta;
    if (datos.tipo) dataToUpdate.tipo = datos.tipo;

    // Validar Estado con Casting (Estatus SÍ sigue siendo Enum)
    if (datos.estado) {
        dataToUpdate.estado = datos.estado as Estatus;
    }

    const actualizado = await prisma.departamento.update({
      where: { id: departamentoId },
      data: dataToUpdate,
    });

    // LOG DE ÉXITO
    await registrarAccion(
      'ACTUALIZAR_DEPARTAMENTO', 
      usuarioId, 
      `Actualizó ID: ${departamentoId}. Datos: ${JSON.stringify(dataToUpdate)}`
    );

    return res.json({
      message: "Departamento actualizado correctamente",
      data: actualizado
    });

  } catch (error: any) {
    // LOG DE ERROR
    if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Datos inválidos", details: error.issues });
    }
    await registrarError('ACTUALIZAR_DEPARTAMENTO', usuarioId, error);
    return res.status(500).json({ error: "Error interno al actualizar el departamento" });
  }
};