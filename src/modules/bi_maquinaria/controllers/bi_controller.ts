/**
 * bi_maquinaria/controllers/bi_controller.ts
 *
 * Controladores HTTP para la FASE 1 del módulo de métricas de maquinaria.
 * Expone los endpoints de diagnóstico y confirmación técnica de fallas.
 *
 * Endpoints implementados en FASE 1:
 *   POST /api/bi/maquinaria/fallas/:fallaId/confirmar
 *   POST /api/bi/maquinaria/fallas/:fallaId/descartar
 *
 * El endpoint de resolución (RESUELTO) se integra directamente en _core.ts
 * a través de resolverFallaEnTransaccion para garantizar la atomicidad.
 */

import type { Request, Response } from "express";
import { registrarError, registrarAccion } from "../../../utils/logger";
import { confirmarFalla, descartarFalla } from "../services/confirmacion_falla_service";
import { confirmarFallaSchema, descartarFallaSchema } from "../zod";

// ---------------------------------------------------------------------------
// POST /api/bi/maquinaria/fallas/:fallaId/confirmar
// El técnico confirma que existe una avería real y provee la fecha confirmada.
// ---------------------------------------------------------------------------
export const confirmarFallaController = async (req: Request, res: Response) => {
  const user = req.user!;

  const validation = confirmarFallaSchema.safeParse({
    params: req.params,
    body: req.body,
  });
  if (!validation.success) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: validation.error.issues,
    });
  }

  const { fallaId } = validation.data.params;
  const { fechaFallaConfirmada } = validation.data.body;

  try {
    const falla = await confirmarFalla({
      fallaId,
      tecnicoId: user.id,
      fechaFallaConfirmada,
    });

    await registrarAccion(
      "CONFIRMAR_FALLA_MAQUINA",
      user.id,
      `FallaMaquina ID: ${fallaId} confirmada. fechaFallaConfirmada: ${fechaFallaConfirmada.toISOString()}`,
    );

    return res.json({
      message: "Falla confirmada correctamente.",
      data: falla,
    });
  } catch (error) {
    await registrarError("CONFIRMAR_FALLA_MAQUINA", user.id, error);
    const msg = error instanceof Error ? error.message : "Error al confirmar la falla.";
    return res.status(400).json({ error: msg });
  }
};

// ---------------------------------------------------------------------------
// POST /api/bi/maquinaria/fallas/:fallaId/descartar
// El técnico determina que no hubo avería real.
// ---------------------------------------------------------------------------
export const descartarFallaController = async (req: Request, res: Response) => {
  const user = req.user!;

  const validation = descartarFallaSchema.safeParse({
    params: req.params,
    body: req.body,
  });
  if (!validation.success) {
    return res.status(400).json({
      error: "Datos inválidos",
      details: validation.error.issues,
    });
  }

  const { fallaId } = validation.data.params;

  try {
    const falla = await descartarFalla({
      fallaId,
      tecnicoId: user.id,
    });

    await registrarAccion(
      "DESCARTAR_FALLA_MAQUINA",
      user.id,
      `FallaMaquina ID: ${fallaId} descartada. Motivo: ${req.body.motivo ?? "no especificado"}`,
    );

    return res.json({
      message: "Falla descartada. No se contabilizará en las métricas.",
      data: falla,
    });
  } catch (error) {
    await registrarError("DESCARTAR_FALLA_MAQUINA", user.id, error);
    const msg = error instanceof Error ? error.message : "Error al descartar la falla.";
    return res.status(400).json({ error: msg });
  }
};
