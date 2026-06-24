import type { Request, Response } from "express";
import { prisma } from "../../db";
import { patchMaquinaSchema } from "./zod";
import { registrarError, registrarAccion } from "../../utils/logger";

export const patchMaquinaEstado = async (req: Request, res: Response) => {
  const user = req.user!;
  const id = Number(req.params.id);

  const validation = patchMaquinaSchema.safeParse({
    params: { id },
    body: req.body
  });

  if (!validation.success) {
    return res.status(400).json({ error: "Datos inválidos", details: validation.error.issues });
  }

  const { body: { estado } } = validation.data;

  try {
    const maquina = await prisma.maquina.findUnique({ where: { id } });
    if (!maquina) {
      return res.status(404).json({ error: "Máquina no encontrada" });
    }

    const maquinaActualizada = await prisma.maquina.update({
      where: { id },
      data: { estado }
    });

    await registrarAccion(
      "PATCH_MAQUINA_ESTADO",
      user.id,
      `Estado de máquina ${maquinaActualizada.codigo} cambiado a ${estado}`
    );

    return res.json({
      status: "success",
      message: "Estado de máquina actualizado correctamente",
      data: maquinaActualizada
    });

  } catch (error) {
    await registrarError("PATCH_MAQUINA_ESTADO", user.id, error);
    return res.status(500).json({ error: "Error interno al actualizar estado de la máquina" });
  }
};
