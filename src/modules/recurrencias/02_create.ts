// src/modules/recurrencias/02_create.ts
// POST /api/recurrencias
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Prisma, ClasificacionTarea, TipoTarea, EstadoTarea } from "@prisma/client";
import type { CreateReglaInput } from "./zod";
import { normalizarFechaLogica, finDeMesUTC } from "./helper";
import { resolverPoliticaMaterializacionRecurrencia } from "./materialization-policy";

const ESTADOS_MAQUINA_NO_OPERATIVOS = new Set(["BAJA", "BAJA", "DESUSO", "INACTIVA"]);

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
    if (ESTADOS_MAQUINA_NO_OPERATIVOS.has(maquina.estado)) {
      return res.status(400).json({ error: "No se pueden crear reglas para una máquina no operativa" });
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
        fechaInicio:           fechaCicloLogicaNormalizada,
        activo:               body.activo ?? true,
      },
      include: {
        maquina:             { select: { id: true, codigo: true, nombre: true, planta: true, area: true } },
        tecnicoResponsable:  { select: { id: true, nombre: true, username: true, email: true } },
      },
    });

    // --- 5. Materializar como máximo un ticket inicial vigente ---
    const hoyLogico = normalizarFechaLogica(new Date());
    let primerTicket = null;
    const decisionInicial = resolverPoliticaMaterializacionRecurrencia(regla, hoyLogico);

    if (decisionInicial.fechaCicloLogica) {
      primerTicket = await materializarCicloInterno({
        regla,
        fechaCicloLogica: decisionInicial.fechaCicloLogica,
        maquinaPlanta: maquina.planta,
        maquinaArea: maquina.area,
        creadorId: req.user!.id,
      });

      await prisma.reglaRecurrencia.update({
        where: { id: regla.id },
        data: { proximaFechaEjecucion: decisionInicial.proximaFechaEjecucion },
      });
    } else if (decisionInicial.requiereActualizarCursor) {
      await prisma.reglaRecurrencia.update({
        where: { id: regla.id },
        data: { proximaFechaEjecucion: decisionInicial.proximaFechaEjecucion },
      });
    }

    const reglaRespuesta = await prisma.reglaRecurrencia.findUnique({
      where: { id: regla.id },
      include: {
        maquina:             { select: { id: true, codigo: true, nombre: true, planta: true, area: true } },
        tecnicoResponsable:  { select: { id: true, nombre: true, username: true, email: true } },
      },
    }) ?? regla;

    return res.status(201).json({
      regla: reglaRespuesta,
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
  fechaProgramadaPreventiva?: Date | null;
  maquinaPlanta: string | null;
  maquinaArea: string | null;
  creadorId: number;
}, db: Pick<typeof prisma, "tarea"> = prisma) {
  const { regla, fechaCicloLogica, fechaProgramadaPreventiva = null, maquinaPlanta, maquinaArea, creadorId } = params;

  const fechaVencimientoMensual = finDeMesUTC(fechaCicloLogica);

  try {
    const ticket = await db.tarea.create({
      data: {
        tipo:              TipoTarea.PLANEADA,
        clasificacion:     ClasificacionTarea.PREVENTIVO,
        titulo:            regla.titulo,
        descripcion:       regla.descripcion ?? `Mantenimiento preventivo programado — ${regla.titulo}`,
        categoria:         regla.categoria,
        prioridad:         regla.prioridad,
        planta:            maquinaPlanta,
        area:              maquinaArea,
        estado:            EstadoTarea.ASIGNADA,
        maquinaId:         regla.maquinaId,
        creadorId:         creadorId,
        tiempoEstimado:    regla.tiempoEstimado ?? null,
        fechaVencimiento:  fechaVencimientoMensual,
        // --- CAMPOS DE RECURRENCIA ---
        reglaRecurrenciaId: regla.id,
        fechaCicloLogica:   fechaCicloLogica,
        fechaProgramadaPreventiva,
        // Asignar al técnico responsable
        responsables: {
          connect: [{ id: regla.tecnicoResponsableId }],
        },
      },
      select: {
        id: true, titulo: true, estado: true,
        fechaVencimiento: true, fechaCicloLogica: true, fechaProgramadaPreventiva: true,
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
      const existente = await db.tarea.findFirst({
        where: { reglaRecurrenciaId: regla.id, fechaCicloLogica },
        select: {
          id: true, titulo: true, estado: true,
          fechaVencimiento: true, fechaCicloLogica: true, fechaProgramadaPreventiva: true,
          reglaRecurrenciaId: true,
        },
      });
      return existente ?? null;
    }
    throw error;
  }
}
