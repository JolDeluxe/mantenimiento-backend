import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol } from "@prisma/client"; 
import { z } from "zod";
import type { CreateDepartamentoInput } from "./types";
import { registrarAccion, registrarError } from "../../utils/logger";

export const createDepartamento = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id || null;

  try {
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado." });
    }

    const { nombre, planta, tipo } = req.body as CreateDepartamentoInput;
    const nombreLimpio = nombre.trim();

    // Validar duplicados
    const existe = await prisma.departamento.findUnique({
      where: { nombre: nombreLimpio },
    });

    if (existe) {
      return res.status(400).json({ error: `El departamento '${nombreLimpio}' ya existe.` });
    }

    // Creación
    const nuevoDepartamento = await prisma.departamento.create({
      data: { 
        nombre: nombreLimpio,
        planta: planta, 
        tipo: tipo 
      },
    });

    await registrarAccion(
      'CREAR_DEPARTAMENTO', 
      usuarioId, 
      `Creó el departamento: ${nombreLimpio} (${planta} - ${tipo})`
    );

    return res.status(201).json({
      message: "Departamento creado",
      data: nuevoDepartamento
    });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Datos inválidos", details: error.issues });
    }
    await registrarError('CREAR_DEPARTAMENTO', usuarioId, error);
    return res.status(500).json({ error: "Error interno al crear el departamento" });
  }
};