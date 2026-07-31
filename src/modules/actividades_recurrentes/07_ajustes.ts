import type { Request, Response } from "express";
import { TipoAjusteRecurrencia } from "@prisma/client";
import { prisma } from "../../db";
import { registrarAccion } from "../../utils/logger";
import { esCicloOperativoDelPatron, esDomingo, fechaEstaEnRango, normalizarFechaLogica } from "../../utils/recurrencia-temporal";
import { estadosMovibles, programacionTarea } from "./helper";
import { reglaActividadInclude, type ReglaActividadConRelaciones } from "./types";

type ReglaOperableResult =
  | { regla: ReglaActividadConRelaciones }
  | { error: string; status: number };

async function obtenerReglaOperable(id: number): Promise<ReglaOperableResult> {
  const regla = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, include: reglaActividadInclude });
  if (!regla) return { error: "Actividad recurrente no encontrada", status: 404 } as const;
  if (regla.archivadoAt) return { error: "La actividad recurrente está archivada", status: 400 } as const;
  if (!regla.activo) return { error: "La actividad recurrente está pausada", status: 400 } as const;
  return { regla } as const;
}

function validarCiclo(regla: NonNullable<Awaited<ReturnType<typeof prisma.reglaActividadRecurrente.findUnique>>>, fecha: Date) {
  const patron = { fechaInicio: regla.fechaInicio, fechaFin: regla.fechaFin, unidad: regla.unidad, intervalo: regla.intervalo };
  if (!esCicloOperativoDelPatron(patron, fecha)) throw new Error("La ocurrencia no pertenece al patrón operativo de la regla");
}

export async function listarAjustesActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const regla = await prisma.reglaActividadRecurrente.findUnique({ where: { id }, select: { id: true } });
    if (!regla) return res.status(404).json({ error: "Actividad recurrente no encontrada" });
    const data = await prisma.reglaActividadRecurrenteAjuste.findMany({
      where: { reglaActividadRecurrenteId: id, activo: true },
      include: { createdBy: { select: { id: true, nombre: true, username: true } } },
      orderBy: { fechaOriginal: "asc" },
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[actividades-recurrentes] listarAjustesActividad error:", error);
    return res.status(500).json({ error: "Error interno al obtener ajustes" });
  }
}

export async function moverOcurrenciaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const state = await obtenerReglaOperable(id);
    if (!("regla" in state)) return res.status(state.status).json({ error: state.error });
    const body = req.body as { fechaOriginal: string; fechaNueva: string; motivo?: string | null };
    const fechaOriginal = normalizarFechaLogica(body.fechaOriginal);
    const fechaNueva = normalizarFechaLogica(body.fechaNueva);
    validarCiclo(state.regla, fechaOriginal);
    if (esDomingo(fechaNueva)) return res.status(400).json({ error: "La fecha nueva no puede ser domingo" });
    if (!fechaEstaEnRango(state.regla, fechaNueva)) return res.status(400).json({ error: "La fecha nueva queda fuera de la vigencia de la regla" });
    const tarea = await prisma.tarea.findFirst({ where: { reglaActividadRecurrenteId: id, fechaCicloLogica: fechaOriginal }, select: { id: true, estado: true } });
    if (tarea && !estadosMovibles.has(tarea.estado)) return res.status(409).json({ error: "La tarea ya está en curso o finalizada y no puede moverse desde la regla" });

    const programacion = programacionTarea(fechaNueva, state.regla);
    const result = await prisma.$transaction(async (tx) => {
      const ajuste = await tx.reglaActividadRecurrenteAjuste.upsert({
        where: { reglaActividadRecurrenteId_fechaOriginal: { reglaActividadRecurrenteId: id, fechaOriginal } },
        update: { tipo: TipoAjusteRecurrencia.MOVER, fechaNueva, motivo: body.motivo ?? null, activo: true },
        create: { reglaActividadRecurrenteId: id, fechaOriginal, tipo: TipoAjusteRecurrencia.MOVER, fechaNueva, motivo: body.motivo ?? null, activo: true, createdById: req.user!.id },
      });
      const tareaActualizada = tarea ? await tx.tarea.update({
        where: { id: tarea.id },
        data: { fechaVencimiento: programacion.fechaVencimiento, horaInicioProgramada: programacion.horaInicioProgramada, horaFinProgramada: programacion.horaFinProgramada },
      }) : null;
      return { ajuste, tareaActualizada };
    });
    await registrarAccion("MOVER_OCURRENCIA_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} | ${body.fechaOriginal} -> ${body.fechaNueva}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno al mover la ocurrencia";
    return res.status(message.includes("no pertenece") ? 400 : 500).json({ error: message });
  }
}

export async function omitirOcurrenciaActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const state = await obtenerReglaOperable(id);
    if (!("regla" in state)) return res.status(state.status).json({ error: state.error });
    const body = req.body as { fechaOriginal: string; motivo: string };
    const fechaOriginal = normalizarFechaLogica(body.fechaOriginal);
    validarCiclo(state.regla, fechaOriginal);
    const tarea = await prisma.tarea.findFirst({ where: { reglaActividadRecurrenteId: id, fechaCicloLogica: fechaOriginal }, select: { id: true } });
    if (tarea) return res.status(409).json({ error: "Ya existe una tarea para esta ocurrencia; resuélvala o cancélela desde el flujo de tareas" });
    const ajuste = await prisma.reglaActividadRecurrenteAjuste.upsert({
      where: { reglaActividadRecurrenteId_fechaOriginal: { reglaActividadRecurrenteId: id, fechaOriginal } },
      update: { tipo: TipoAjusteRecurrencia.OMITIR, fechaNueva: null, motivo: body.motivo, activo: true },
      create: { reglaActividadRecurrenteId: id, fechaOriginal, tipo: TipoAjusteRecurrencia.OMITIR, fechaNueva: null, motivo: body.motivo, activo: true, createdById: req.user!.id },
    });
    await registrarAccion("OMITIR_OCURRENCIA_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} | ${body.fechaOriginal}`);
    return res.json({ success: true, data: ajuste });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno al omitir la ocurrencia";
    return res.status(message.includes("no pertenece") ? 400 : 500).json({ error: message });
  }
}

export async function quitarAjusteActividad(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    const state = await obtenerReglaOperable(id);
    if (!("regla" in state)) return res.status(state.status).json({ error: state.error });
    const fechaOriginal = normalizarFechaLogica((req.body as { fechaOriginal: string }).fechaOriginal);
    const ajuste = await prisma.reglaActividadRecurrenteAjuste.findUnique({ where: { reglaActividadRecurrenteId_fechaOriginal: { reglaActividadRecurrenteId: id, fechaOriginal } } });
    if (!ajuste?.activo) return res.status(404).json({ error: "No existe un ajuste activo para esta ocurrencia" });
    const tarea = await prisma.tarea.findFirst({ where: { reglaActividadRecurrenteId: id, fechaCicloLogica: fechaOriginal }, select: { id: true, estado: true } });
    if (tarea && !estadosMovibles.has(tarea.estado)) return res.status(409).json({ error: "La tarea ya está en curso o finalizada y no puede restaurarse desde la regla" });
    const programacion = programacionTarea(fechaOriginal, state.regla);
    const result = await prisma.$transaction(async (tx) => {
      const ajusteActualizado = await tx.reglaActividadRecurrenteAjuste.update({ where: { id: ajuste.id }, data: { activo: false } });
      const tareaActualizada = tarea ? await tx.tarea.update({
        where: { id: tarea.id },
        data: { fechaVencimiento: programacion.fechaVencimiento, horaInicioProgramada: programacion.horaInicioProgramada, horaFinProgramada: programacion.horaFinProgramada },
      }) : null;
      return { ajuste: ajusteActualizado, tareaActualizada };
    });
    await registrarAccion("QUITAR_AJUSTE_ACTIVIDAD_RECURRENTE", req.user!.id, `Regla ${id} | ${fechaOriginal.toISOString()}`);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[actividades-recurrentes] quitarAjusteActividad error:", error);
    return res.status(500).json({ error: "Error interno al quitar el ajuste" });
  }
}
