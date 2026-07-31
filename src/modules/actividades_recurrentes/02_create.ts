import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import { esDomingo, minutosDesdeHora, normalizarFechaLogica, siguienteCicloOperativo } from "../../utils/recurrencia-temporal";
import { ActividadRecurrenteError, dtoReglaActividad, validarResponsablesActivos } from "./helper";
import { reglaActividadInclude } from "./types";
import type { CreateReglaActividadInput } from "./zod";

export async function crearReglaActividad(req: Request, res: Response) {
  try {
    const body = req.body as CreateReglaActividadInput;
    const responsables = await validarResponsablesActivos(body.responsables);
    const horaInicioMinutos = body.horaInicio ? minutosDesdeHora(body.horaInicio) : null;
    const horaFinMinutos = body.horaFin ? minutosDesdeHora(body.horaFin) : null;
    const tiempoEstimado = horaInicioMinutos != null && horaFinMinutos != null
      ? horaFinMinutos - horaInicioMinutos
      : body.tiempoEstimado!;
    const fechaInicio = normalizarFechaLogica(body.fechaInicio);
    if (esDomingo(fechaInicio) && (body.unidad === "SEMANA" || (body.unidad === "DIA" && body.intervalo % 7 === 0))) {
      return res.status(400).json({ error: "La fecha inicial no puede anclar una recurrencia que siempre caería en domingo" });
    }
    const proximaFechaEjecucion = esDomingo(fechaInicio)
      ? siguienteCicloOperativo({ fechaInicio, fechaFin: null, unidad: body.unidad, intervalo: body.intervalo }, fechaInicio)
      : fechaInicio;

    const regla = await prisma.reglaActividadRecurrente.create({
      data: {
        titulo: body.titulo,
        descripcion: body.descripcion ?? null,
        categoria: body.categoria,
        planta: body.planta ?? null,
        area: body.area,
        prioridad: body.prioridad,
        fechaInicio,
        fechaFin: body.fechaFin ? normalizarFechaLogica(body.fechaFin) : null,
        horaInicioMinutos,
        horaFinMinutos,
        tiempoEstimado,
        unidad: body.unidad,
        intervalo: body.intervalo,
        proximaFechaEjecucion,
        creadorId: req.user!.id,
        responsables: { connect: responsables.map((id) => ({ id })) },
      },
      include: reglaActividadInclude,
    });
    await registrarAccion("CREAR_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${regla.id} creada`);
    return res.status(201).json({ success: true, data: dtoReglaActividad(regla) });
  } catch (error) {
    if (error instanceof ActividadRecurrenteError) return res.status(error.status).json({ error: error.message });
    console.error("[actividades-recurrentes] crearReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al crear la actividad recurrente" });
  }
}
