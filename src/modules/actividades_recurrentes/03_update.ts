import type { Request, Response } from "express";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import { minutosDesdeHora, normalizarFechaLogica } from "../../utils/recurrencia-temporal";
import { ActividadRecurrenteError, dtoReglaActividad, validarResponsablesActivos } from "./helper";
import { reglaActividadInclude } from "./types";
import type { UpdateReglaActividadInput } from "./zod";

export async function actualizarReglaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const body = req.body as UpdateReglaActividadInput;
    const actual = await prisma.reglaActividadRecurrente.findUnique({ where: { id } });
    if (!actual) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    if (actual.archivadoAt) return res.status(400).json({ error: "Una actividad archivada debe restaurarse antes de editarse" });

    const horaInicio = body.horaInicio === undefined ? actual.horaInicioMinutos : body.horaInicio === null ? null : minutosDesdeHora(body.horaInicio);
    const horaFin = body.horaFin === undefined ? actual.horaFinMinutos : body.horaFin === null ? null : minutosDesdeHora(body.horaFin);
    if ((horaInicio == null) !== (horaFin == null)) {
      return res.status(400).json({ error: "horaInicio y horaFin deben conservarse juntos" });
    }
    if (horaInicio != null && horaFin != null && horaFin <= horaInicio) {
      return res.status(400).json({ error: "El horario no puede cruzar medianoche" });
    }
    const tiempoEstimado = horaInicio != null && horaFin != null
      ? horaFin - horaInicio
      : body.tiempoEstimado === undefined ? actual.tiempoEstimado : body.tiempoEstimado;
    if (horaInicio == null && (!tiempoEstimado || tiempoEstimado <= 0)) {
      return res.status(400).json({ error: "tiempoEstimado es obligatorio cuando no hay horario" });
    }
    const fechaFin = body.fechaFin === undefined ? actual.fechaFin : body.fechaFin === null ? null : normalizarFechaLogica(body.fechaFin);
    if (fechaFin && fechaFin < normalizarFechaLogica(actual.fechaInicio)) {
      return res.status(400).json({ error: "fechaFin no puede ser anterior a fechaInicio" });
    }
    const responsables = body.responsables === undefined ? undefined : await validarResponsablesActivos(body.responsables);

    const regla = await prisma.reglaActividadRecurrente.update({
      where: { id },
      data: {
        ...(body.titulo !== undefined ? { titulo: body.titulo } : {}),
        ...(body.descripcion !== undefined ? { descripcion: body.descripcion } : {}),
        ...(body.categoria !== undefined ? { categoria: body.categoria } : {}),
        ...(body.planta !== undefined ? { planta: body.planta } : {}),
        ...(body.area !== undefined ? { area: body.area } : {}),
        ...(body.prioridad !== undefined ? { prioridad: body.prioridad } : {}),
        fechaFin,
        horaInicioMinutos: horaInicio,
        horaFinMinutos: horaFin,
        tiempoEstimado,
        ...(responsables === undefined ? {} : { responsables: { set: responsables.map((responsableId) => ({ id: responsableId })) } }),
      },
      include: reglaActividadInclude,
    });
    await registrarAccion("ACTUALIZAR_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} actualizada`);
    return res.json({ success: true, data: dtoReglaActividad(regla), mensaje: "La regla fue actualizada; las tareas ya materializadas no cambiaron" });
  } catch (error) {
    if (error instanceof ActividadRecurrenteError) return res.status(error.status).json({ error: error.message });
    console.error("[actividades-recurrentes] actualizarReglaActividad error:", error);
    return res.status(500).json({ error: "Error interno al actualizar la actividad recurrente" });
  }
}
