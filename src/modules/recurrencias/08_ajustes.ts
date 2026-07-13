import type { Request, Response } from "express";
import { EstadoTarea, TipoAjusteRecurrencia } from "@prisma/client";
import { prisma } from "../../db";
import { finDeMesUTC } from "./helper";
import { normalizarFechaOriginalUTC, obtenerPeriodoDesdeFecha } from "./ajustes-helper";
import type { MoverOcurrenciaInput, OmitirOcurrenciaInput, QuitarAjusteInput } from "./zod";

const ESTADOS_MOVIBLES = new Set<EstadoTarea>([EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA]);
const ESTADOS_BLOQUEADOS = new Set<EstadoTarea>([
  EstadoTarea.EN_PROGRESO,
  EstadoTarea.EN_PAUSA,
  EstadoTarea.RESUELTO,
  EstadoTarea.CERRADO,
  EstadoTarea.CANCELADA,
]);

const getRegla = async (id: number) =>
  prisma.reglaRecurrencia.findUnique({
    where: { id },
    select: { id: true, activo: true },
  });

const getTareaDeOcurrencia = async (reglaId: number, fechaOriginal: Date) =>
  prisma.tarea.findFirst({
    where: { reglaRecurrenciaId: reglaId, fechaCicloLogica: fechaOriginal },
    select: {
      id: true,
      estado: true,
      fechaCicloLogica: true,
      fechaProgramadaPreventiva: true,
    },
  });

export const listarAjustesRegla = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const regla = await getRegla(id);
    if (!regla) return res.status(404).json({ error: "Programación no encontrada" });

    const ajustes = await prisma.reglaRecurrenciaAjuste.findMany({
      where: { reglaRecurrenciaId: id, activo: true },
      orderBy: [{ fechaOriginal: "asc" }],
      include: { createdBy: { select: { id: true, nombre: true, username: true } } },
    });

    return res.json({ success: true, total: ajustes.length, data: ajustes });
  } catch (error) {
    console.error("[recurrencias] listarAjustesRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const moverOcurrencia = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as MoverOcurrenciaInput;
    const fechaOriginal = normalizarFechaOriginalUTC(body.fechaOriginal);
    const fechaNueva = normalizarFechaOriginalUTC(body.fechaNueva);
    const periodo = obtenerPeriodoDesdeFecha(fechaOriginal);

    const regla = await getRegla(id);
    if (!regla) return res.status(404).json({ error: "Programación no encontrada" });
    if (!regla.activo) return res.status(400).json({ error: "La programación está inactiva" });

    const tarea = await getTareaDeOcurrencia(id, fechaOriginal);
    if (tarea && ESTADOS_BLOQUEADOS.has(tarea.estado)) {
      return res.status(400).json({
        error: "Esta ocurrencia ya tiene un mantenimiento en curso o cerrado. No se puede mover desde ajustes.",
      });
    }

    const ajuste = await prisma.reglaRecurrenciaAjuste.upsert({
      where: {
        reglaRecurrenciaId_fechaOriginal: {
          reglaRecurrenciaId: id,
          fechaOriginal,
        },
      },
      update: {
        tipo: TipoAjusteRecurrencia.MOVER,
        fechaNueva,
        motivo: body.motivo ?? null,
        activo: true,
        ...periodo,
      },
      create: {
        reglaRecurrenciaId: id,
        fechaOriginal,
        tipo: TipoAjusteRecurrencia.MOVER,
        fechaNueva,
        motivo: body.motivo ?? null,
        activo: true,
        createdById: req.user!.id,
        ...periodo,
      },
    });

    let tareaActualizada = null;
    if (tarea && ESTADOS_MOVIBLES.has(tarea.estado)) {
      tareaActualizada = await prisma.tarea.update({
        where: { id: tarea.id },
        data: {
          fechaProgramadaPreventiva: fechaNueva,
          fechaVencimiento: finDeMesUTC(fechaOriginal),
        },
        select: { id: true, estado: true, fechaCicloLogica: true, fechaProgramadaPreventiva: true, fechaVencimiento: true },
      });
    }

    return res.json({
      success: true,
      ajuste,
      tareaActualizada,
      mensaje: "Ocurrencia movida para este periodo. La programación base no cambia.",
    });
  } catch (error) {
    console.error("[recurrencias] moverOcurrencia error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const omitirOcurrencia = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as OmitirOcurrenciaInput;
    const fechaOriginal = normalizarFechaOriginalUTC(body.fechaOriginal);
    const periodo = obtenerPeriodoDesdeFecha(fechaOriginal);

    const regla = await getRegla(id);
    if (!regla) return res.status(404).json({ error: "Programación no encontrada" });
    if (!regla.activo) return res.status(400).json({ error: "La programación está inactiva" });

    const tarea = await getTareaDeOcurrencia(id, fechaOriginal);
    if (tarea) {
      return res.status(400).json({
        error: "Ya existe un mantenimiento generado para esta ocurrencia. Primero resuelve/cancela la tarea desde el flujo correspondiente.",
      });
    }

    const ajuste = await prisma.reglaRecurrenciaAjuste.upsert({
      where: {
        reglaRecurrenciaId_fechaOriginal: {
          reglaRecurrenciaId: id,
          fechaOriginal,
        },
      },
      update: {
        tipo: TipoAjusteRecurrencia.OMITIR,
        fechaNueva: null,
        motivo: body.motivo,
        activo: true,
        ...periodo,
      },
      create: {
        reglaRecurrenciaId: id,
        fechaOriginal,
        tipo: TipoAjusteRecurrencia.OMITIR,
        fechaNueva: null,
        motivo: body.motivo,
        activo: true,
        createdById: req.user!.id,
        ...periodo,
      },
    });

    return res.json({
      success: true,
      ajuste,
      mensaje: "Ocurrencia omitida para este periodo. No se generará mantenimiento ni se marcará como descuido.",
    });
  } catch (error) {
    console.error("[recurrencias] omitirOcurrencia error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const quitarAjusteOcurrencia = async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const body = req.body as QuitarAjusteInput;
    const fechaOriginal = normalizarFechaOriginalUTC(body.fechaOriginal);

    const regla = await getRegla(id);
    if (!regla) return res.status(404).json({ error: "Programación no encontrada" });

    const ajuste = await prisma.reglaRecurrenciaAjuste.findUnique({
      where: {
        reglaRecurrenciaId_fechaOriginal: {
          reglaRecurrenciaId: id,
          fechaOriginal,
        },
      },
    });
    if (!ajuste || !ajuste.activo) {
      return res.status(404).json({ error: "No hay ajuste activo para esta ocurrencia" });
    }

    const tarea = await getTareaDeOcurrencia(id, fechaOriginal);
    if (tarea && !ESTADOS_MOVIBLES.has(tarea.estado)) {
      return res.status(400).json({
        error: "Esta ocurrencia ya tiene un mantenimiento en curso o cerrado. No se puede quitar el ajuste desde aquí.",
      });
    }

    const ajusteActualizado = await prisma.reglaRecurrenciaAjuste.update({
      where: { id: ajuste.id },
      data: { activo: false },
    });

    let tareaActualizada = null;
    if (tarea && ESTADOS_MOVIBLES.has(tarea.estado)) {
      tareaActualizada = await prisma.tarea.update({
        where: { id: tarea.id },
        data: { fechaProgramadaPreventiva: null, fechaVencimiento: finDeMesUTC(fechaOriginal) },
        select: { id: true, estado: true, fechaCicloLogica: true, fechaProgramadaPreventiva: true, fechaVencimiento: true },
      });
    }

    return res.json({
      success: true,
      ajuste: ajusteActualizado,
      tareaActualizada,
      mensaje: "La ocurrencia volvió a la programación base.",
    });
  } catch (error) {
    console.error("[recurrencias] quitarAjusteOcurrencia error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

