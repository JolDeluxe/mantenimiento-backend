import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarError, registrarAccion } from "../../utils/logger";

const KEY_FLAG = "AUTONOMOS_HABILITADOS";

export const getAutonomosConfig = async (req: Request, res: Response) => {
  const user = req.user!;
  try {
    const config = await prisma.configuracionSistema.findUnique({
      where: { clave: KEY_FLAG }
    });

    const habilitado = config?.valor === "true";
    return res.status(200).json({ habilitado });
  } catch (error) {
    await registrarError("GET_AUTONOMOS_CONFIG", user.id, error);
    return res.status(500).json({ error: "Error al obtener la configuración de autónomos" });
  }
};

export const patchAutonomosConfig = async (req: Request, res: Response) => {
  const user = req.user!;
  const { habilitado } = req.body;

  try {
    const valorString = habilitado ? "true" : "false";

    const config = await prisma.configuracionSistema.upsert({
      where: { clave: KEY_FLAG },
      update: { valor: valorString },
      create: {
        clave: KEY_FLAG,
        valor: valorString,
        descripcion: "Flag global para habilitar mantenimientos autónomos en portal público"
      }
    });

    await registrarAccion(
      "MODIFICAR_AUTONOMOS_FLAG",
      user.id,
      `Flag de autónomos modificado a: ${valorString}`
    );

    return res.status(200).json({
      habilitado: config.valor === "true"
    });
  } catch (error) {
    await registrarError("PATCH_AUTONOMOS_CONFIG", user.id, error);
    return res.status(500).json({ error: "Error al actualizar la configuración de autónomos" });
  }
};
