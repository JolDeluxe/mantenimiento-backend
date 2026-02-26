import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client"; 
import { registrarAccion, registrarError } from "../../utils/logger"; 
import { validarProteccionDepartamento } from "./helper"; 
import type { UpdateDepartamentoInput, UpdateDepartamentoParams } from "./zod";

export const updateDepartamento = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id || null;

  try {
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado" });
    }

    const { id } = req.params as unknown as UpdateDepartamentoParams;
    const datos = req.body as UpdateDepartamentoInput; 

    const deptoActual = await prisma.departamento.findUnique({ where: { id } });

    if (!deptoActual) {
      return res.status(404).json({ error: "Departamento no encontrado" });
    }

    try {
      validarProteccionDepartamento(deptoActual, { nombre: datos.nombre, estado: datos.estado });
    } catch (error: any) {
      return res.status(403).json({ error: error.message });
    }

    const dataToUpdate: any = {};

    if (datos.nombre) {
      const nombreLimpio = datos.nombre.trim();
      if (nombreLimpio !== deptoActual.nombre) {
        const duplicado = await prisma.departamento.findUnique({ where: { nombre: nombreLimpio } });
        if (duplicado) {
          return res.status(400).json({ error: "Ya existe otro departamento con ese nombre" });
        }
        dataToUpdate.nombre = nombreLimpio;
      }
    }

    if (datos.planta) dataToUpdate.planta = datos.planta;
    if (datos.tipo) dataToUpdate.tipo = datos.tipo;
    if (datos.estado) dataToUpdate.estado = datos.estado as Estatus;

    const actualizado = await prisma.departamento.update({
      where: { id },
      data: dataToUpdate,
    });

    await registrarAccion('ACTUALIZAR_DEPARTAMENTO', usuarioId, `Actualizó ID: ${id}. Datos: ${JSON.stringify(dataToUpdate)}`);

    return res.json({
      message: "Departamento actualizado correctamente",
      data: actualizado
    });

  } catch (error: any) {
    await registrarError('ACTUALIZAR_DEPARTAMENTO', usuarioId, error);
    return res.status(500).json({ error: "Error interno al actualizar el departamento" });
  }
};