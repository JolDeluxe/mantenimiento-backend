import type { Request, Response } from "express";
import { prisma } from "../../db";
import { updateMaquinaSchema } from "./zod";
import { registrarError, registrarAccion } from "../../utils/logger";

export const updateMaquina = async (req: Request, res: Response) => {
  const user = req.user!;
  const id = Number(req.params.id);

  const validation = updateMaquinaSchema.safeParse({
    params: { id },
    body: req.body
  });

  if (!validation.success) {
    return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }

  const { body: data } = validation.data;

  try {
    const maquina = await prisma.maquina.findUnique({ where: { id } });
    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    if (data.numeroSerie) {
      const serieExistente = await prisma.maquina.findFirst({
        where: { numeroSerie: data.numeroSerie, NOT: { id } }
      });
      if (serieExistente) {
        return res.status(400).json({ error: `La máquina con número de serie ${data.numeroSerie} ya está registrada` });
      }
    }

    const maquinaActualizada = await prisma.maquina.update({
      where: { id },
      data: {
        nombre: data.nombre,
        proceso: data.proceso,
        descripcion: data.descripcion,
        criticidad: data.criticidad,
        estado: data.estado,
        marca: data.marca,
        modelo: data.modelo,
        numeroSerie: data.numeroSerie,
        planta: data.planta,
        area: data.area,
        ubicacionDetalle: data.ubicacionDetalle,
        departamentoId: data.departamentoId,
        fechaInstalacion: data.fechaInstalacion
      }
    });

    await registrarAccion("UPDATE_MAQUINA", user.id, `Máquina actualizada: ${maquinaActualizada.codigo}`);

    return res.json({
      status: "success",
      message: "Máquina actualizada correctamente",
      data: maquinaActualizada
    });

  } catch (error) {
    await registrarError("UPDATE_MAQUINA", user.id, error);
    return res.status(500).json({ error: "Error interno al actualizar la máquina" });
  }
};
