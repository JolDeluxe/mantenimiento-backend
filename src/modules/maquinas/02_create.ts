import type { Request, Response } from "express";
import { prisma } from "../../db";
import { createMaquinaSchema } from "./zod";
import { registrarError, registrarAccion } from "../../utils/logger";

export const createMaquina = async (req: Request, res: Response) => {
  const user = req.user!;

  const validation = createMaquinaSchema.safeParse({
    body: req.body
  });
  if (!validation.success) {
    return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }

  const { body: data } = validation.data;

  try {
    const maquinaExistente = await prisma.maquina.findUnique({
      where: { codigo: data.codigo }
    });

    if (maquinaExistente) {
      return res.status(400).json({ error: `La máquina con código ${data.codigo} ya está registrada` });
    }

    if (data.numeroSerie) {
      const serieExistente = await prisma.maquina.findUnique({
        where: { numeroSerie: data.numeroSerie }
      });
      if (serieExistente) {
        return res.status(400).json({ error: `La máquina con número de serie ${data.numeroSerie} ya está registrada` });
      }
    }

    const nuevaMaquina = await prisma.maquina.create({
      data: {
        codigo: data.codigo,
        nombre: data.nombre,
        proceso: data.proceso,
        descripcion: data.descripcion,
        criticidad: data.criticidad,
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

    await registrarAccion("CREAR_MAQUINA", user.id, `Máquina creada: ${nuevaMaquina.codigo} - ${nuevaMaquina.nombre}`);

    return res.status(201).json({
      status: "success",
      message: "Máquina registrada exitosamente",
      data: nuevaMaquina
    });

  } catch (error) {
    await registrarError("CREATE_MAQUINA", user.id, error);
    return res.status(500).json({ error: "Error interno al guardar la máquina" });
  }
};
