import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarAccion, registrarError } from "../../utils/logger";
import { validarNombreUnico } from "./helper";
import type { CreateDepartamentoInput } from "./types";

export const createDepartamento = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id; 

  try {
    const { nombre, planta, tipo } = req.body as CreateDepartamentoInput;
    
    const nombreFinal = nombre.trim().toUpperCase();

    const esNombreUnico = await validarNombreUnico(nombreFinal);
    if (!esNombreUnico) {
      return res.status(400).json({ 
        error: `Ya existe el departamento '${nombreFinal}' en el sistema.` 
      });
    }

    const nuevoDepartamento = await prisma.departamento.create({
      data: { 
        nombre: nombreFinal,
        planta, 
        tipo 
      },
    });

    await registrarAccion(
      'CREAR_DEPARTAMENTO', 
      usuarioId!, 
      `Creó el departamento: ${nombreFinal}`
    );

    return res.status(201).json({
      message: "Departamento creado exitosamente",
      data: nuevoDepartamento
    });

  } catch (error) {
    await registrarError('CREAR_DEPARTAMENTO', usuarioId || 0, error);
    return res.status(500).json({ error: "Error interno al crear el departamento" });
  }
};
