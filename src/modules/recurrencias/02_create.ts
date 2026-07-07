// src/modules/recurrencias/02_create.ts
// POST /api/recurrencias
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Prisma, ClasificacionTarea, TipoTarea, EstadoTarea } from "@prisma/client";
import type { CreateReglaInput } from "./zod";
import { normalizarFechaLogica, ajustarPorFinDeSemana } from "./helper";

export const createRegla = async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateReglaInput;

    // --- 1. Validar que la máquina existe y no está de baja ---
    const maquina = await prisma.maquina.findUnique({
      where: { id: body.maquinaId },
      select: { id: true, planta: true, area: true, estado: true },
    });
    if (!maquina) {
      return res.status(400).json({ error: "La máquina especificada no existe" });
    }
    if (maquina.estado === "BAJA" || maquina.estado === "BAJA_ERP") {
      return res.status(400).json({ error: "No se pueden crear reglas para una máquina dada de baja" });
    }

    // --- 2. Validar que el técnico existe y está activo ---
    const tecnico = await prisma.usuario.findUnique({
      where: { id: body.tecnicoResponsableId },
      select: { id: true, nombre: true, estado: true, rol: true },
    });
    if (!tecnico) {
      return res.status(400).json({ error: "El técnico responsable especificado no existe" });
    }
    if (tecnico.estado !== "ACTIVO") {
      return res.status(400).json({ error: "El técnico responsable no está activo" });
    }

    // --- 3. Normalizar la fecha lógica del primer ciclo ---
    const fechaCicloLogicaNormalizada = normalizarFechaLogica(body.proximaFechaEjecucion);

    // --- 4. Crear la regla ---
    const regla = await prisma.reglaRecurrencia.create({
      data: {
        maquinaId:            body.maquinaId,
        titulo:               body.titulo,
        descripcion:          body.descripcion ?? null,
        categoria:            body.categoria ?? "MAQUINARIA",
        prioridad:            body.prioridad,
        tiempoEstimado:       body.tiempoEstimado ?? null,
        frecuencia:           body.frecuencia,
        intervaloDias:        body.intervaloDias ?? null,
        tecnicoResponsableId: body.tecnicoResponsableId,
        proximaFechaEjecucion: fechaCicloLogicaNormalizada,
        activo:               body.activo ?? true,
      },
      include: {
        maquina:             { select: { id: true, codigo: true, nombre: true, planta: true, area: true } },
        tecnicoResponsable:  { select: { id: true, nombre: true, username: true, email: true } },
      },
    });

    // --- 5. Materializar el primer ticket automáticamente ---
    // Solo si la proximaFechaEjecucion es hoy o pasada (el ciclo ya venció)
    const hoyLogico = normalizarFechaLogica(new Date());
    let primerTicket = null;

    if (fechaCicloLogicaNormalizada <= hoyLogico) {
      primerTicket = await materializarCicloInterno({
        regla,
        fechaCicloLogica: fechaCicloLogicaNormalizada,
        maquinaPlanta: maquina.planta,
        maquinaArea: maquina.area,
        creadorId: req.user!.id,
      });
    }

    return res.status(201).json({
      regla,
      primerTicketCreado: primerTicket ?? null,
      mensaje: primerTicket
        ? "Regla creada y primer ticket materializado automáticamente"
        : "Regla creada. El primer ticket se materializará cuando llegue la fecha del ciclo",
    });
  } catch (error) {
    console.error("[recurrencias] createRegla error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// ---------------------------------------------------------------------------
// Función interna reutilizable por create y /materialize
// ---------------------------------------------------------------------------
export async function materializarCicloInterno(params: {
  regla: { id: number; maquinaId: number; titulo: string; descripcion?: string | null; categoria: string; prioridad: any; tiempoEstimado?: number | null; tecnicoResponsableId: number };
  fechaCicloLogica: Date;
  maquinaPlanta: string;
  maquinaArea: string;
  creadorId: number;
}) {
  const { regla, fechaCicloLogica, maquinaPlanta, maquinaArea, creadorId } = params;

  // Ajuste físico para fechaVencimiento (solo para presentación / agenda del técnico)
  const fechaVencimientoFisica = ajustarPorFinDeSemana(fechaCicloLogica);

  try {
    const ticket = await prisma.tarea.create({
      data: {
        tipo:              TipoTarea.PLANEADA,
        clasificacion:     ClasificacionTarea.PREVENTIVO,
        titulo:            regla.titulo,
        descripcion:       regla.descripcion ?? `Mantenimiento preventivo programado — ${regla.titulo}`,
        categoria:         regla.categoria,
        prioridad:         regla.prioridad,
        planta:            maquinaPlanta,
        area:              maquinaArea,
        estado:            EstadoTarea.PENDIENTE,
        maquinaId:         regla.maquinaId,
        creadorId:         creadorId,
        tiempoEstimado:    regla.tiempoEstimado ?? null,
        fechaVencimiento:  fechaVencimientoFisica,
        // --- CAMPOS DE RECURRENCIA ---
        reglaRecurrenciaId: regla.id,
        fechaCicloLogica:   fechaCicloLogica,
        // Asignar al técnico responsable
        responsables: {
          connect: [{ id: regla.tecnicoResponsableId }],
        },
      },
      select: {
        id: true, titulo: true, estado: true,
        fechaVencimiento: true, fechaCicloLogica: true,
        reglaRecurrenciaId: true,
      },
    });

    return ticket;
  } catch (error: any) {
    // Unique constraint: el ciclo ya fue materializado (idempotente — no es crash)
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Devolver el ticket existente
      const existente = await prisma.tarea.findFirst({
        where: { reglaRecurrenciaId: regla.id, fechaCicloLogica },
        select: {
          id: true, titulo: true, estado: true,
          fechaVencimiento: true, fechaCicloLogica: true,
          reglaRecurrenciaId: true,
        },
      });
      return existente ?? null;
    }
    throw error;
  }
}
