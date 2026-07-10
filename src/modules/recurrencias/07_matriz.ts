// src/modules/recurrencias/07_matriz.ts
// GET /api/recurrencias/matriz?year=2026
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { formatearFechaUTC, generarProyeccionesPorAno, mismoPeriodoMes } from "./helper";

type MesesMatriz = Record<string, Array<{
  fechaInicio: string;
  fechaFin: string | null;
  fechaTerminacion: string | null;
  estado: string;
  estadoTicket: string | null;
  estadoMensual: "REALIZADO_EN_MES" | "REALIZADO_FUERA_DEL_MES" | "PENDIENTE_DEL_MES" | "PROGRAMADO_POR_RECURRENCIA";
  ticketId: number | null;
  origen: "ticket" | "proyeccion";
  pendienteMaterializar: boolean;
}>>;

const ESTADOS_MAQUINA_OCULTOS = ["BAJA", "BAJA_ERP", "DESUSO", "INACTIVA"];
const ESTADOS_TERMINADOS = new Set(["RESUELTO", "CERRADO"]);

const crearMesesVacios = (): MesesMatriz =>
  Object.fromEntries(Array.from({ length: 12 }, (_, index) => [String(index + 1), []])) as MesesMatriz;

const keyCiclo = (reglaId: number, fecha: Date) => `${reglaId}|${fecha.toISOString()}`;

const estadoMensualTicket = (ticket: { estado: string; finalizadoAt: Date | null; fechaCicloLogica: Date | null }) => {
  if (ESTADOS_TERMINADOS.has(ticket.estado) && ticket.finalizadoAt) {
    return mismoPeriodoMes(ticket.fechaCicloLogica, ticket.finalizadoAt)
      ? "REALIZADO_EN_MES"
      : "REALIZADO_FUERA_DEL_MES";
  }
  return "PENDIENTE_DEL_MES";
};

export const getMatrizRecurrencias = async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year) || new Date().getFullYear();
    const incluirBaja = String(req.query.incluirBaja) === "true";
    const inicioAno = new Date(Date.UTC(year, 0, 1));
    const finAno = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const reglas = await prisma.reglaRecurrencia.findMany({
      where: {
        activo: true,
        ...(!incluirBaja && { maquina: { estado: { notIn: ESTADOS_MAQUINA_OCULTOS } } }),
      },
      select: {
        id: true,
        titulo: true,
        categoria: true,
        prioridad: true,
        tiempoEstimado: true,
        frecuencia: true,
        intervaloDias: true,
        proximaFechaEjecucion: true,
        activo: true,
        maquina: {
          select: {
            id: true,
            codigo: true,
            nombre: true,
            proceso: true,
            planta: true,
            area: true,
            estado: true,
          },
        },
        tecnicoResponsable: {
          select: { id: true, nombre: true, username: true, email: true },
        },
      },
      orderBy: [
        { maquina: { codigo: "asc" } },
        { proximaFechaEjecucion: "asc" },
        { id: "asc" },
      ],
    });

    const reglaIds = reglas.map((regla) => regla.id);

    const ticketsReales = reglaIds.length > 0
      ? await prisma.tarea.findMany({
          where: {
            reglaRecurrenciaId: { in: reglaIds },
            fechaCicloLogica: { gte: inicioAno, lte: finAno },
          },
          select: {
            id: true,
            estado: true,
            fechaCicloLogica: true,
            fechaVencimiento: true,
            finalizadoAt: true,
            reglaRecurrenciaId: true,
          },
        })
      : [];

    const ticketsPorCiclo = new Map(
      ticketsReales
        .filter((ticket) => ticket.reglaRecurrenciaId != null && ticket.fechaCicloLogica != null)
        .map((ticket) => [
          keyCiclo(ticket.reglaRecurrenciaId!, ticket.fechaCicloLogica!),
          ticket,
        ]),
    );

    const rows = reglas.map((regla) => {
      const meses = crearMesesVacios();
      const ciclosAgregados = new Set<string>();
      const ciclos = generarProyeccionesPorAno(
        regla.proximaFechaEjecucion,
        regla.frecuencia,
        regla.intervaloDias,
        year,
      );

      for (const ciclo of ciclos) {
        const key = keyCiclo(regla.id, ciclo);
        const ticket = ticketsPorCiclo.get(key);
        const mes = String(ciclo.getUTCMonth() + 1);
        ciclosAgregados.add(key);

        meses[mes]!.push({
          fechaInicio: formatearFechaUTC(ciclo),
          fechaFin: ticket?.finalizadoAt ? formatearFechaUTC(ticket.finalizadoAt) : ticket?.fechaVencimiento ? formatearFechaUTC(ticket.fechaVencimiento) : null,
          fechaTerminacion: ticket?.finalizadoAt ? formatearFechaUTC(ticket.finalizadoAt) : null,
          estado: ticket ? estadoMensualTicket(ticket) : "PROGRAMADO_POR_RECURRENCIA",
          estadoTicket: ticket?.estado ?? null,
          estadoMensual: ticket ? estadoMensualTicket(ticket) : "PROGRAMADO_POR_RECURRENCIA",
          ticketId: ticket?.id ?? null,
          origen: ticket ? "ticket" : "proyeccion",
          pendienteMaterializar: ticket == null,
        });
      }

      for (const ticket of ticketsReales) {
        if (ticket.reglaRecurrenciaId !== regla.id || !ticket.fechaCicloLogica) continue;
        const key = keyCiclo(regla.id, ticket.fechaCicloLogica);
        if (ciclosAgregados.has(key)) continue;

        const mes = String(ticket.fechaCicloLogica.getUTCMonth() + 1);
        meses[mes]!.push({
          fechaInicio: formatearFechaUTC(ticket.fechaCicloLogica),
          fechaFin: ticket.finalizadoAt ? formatearFechaUTC(ticket.finalizadoAt) : ticket.fechaVencimiento ? formatearFechaUTC(ticket.fechaVencimiento) : null,
          fechaTerminacion: ticket.finalizadoAt ? formatearFechaUTC(ticket.finalizadoAt) : null,
          estado: estadoMensualTicket(ticket),
          estadoTicket: ticket.estado,
          estadoMensual: estadoMensualTicket(ticket),
          ticketId: ticket.id,
          origen: "ticket",
          pendienteMaterializar: false,
        });
      }

      for (const mes of Object.keys(meses)) {
        meses[mes]!.sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio));
      }

      return {
        maquina: {
          id: regla.maquina.id,
          codigo: regla.maquina.codigo,
          nombre: regla.maquina.nombre,
          categoria: regla.categoria,
          tipoMaquinaria: regla.maquina.proceso,
          area: regla.maquina.area,
          planta: regla.maquina.planta,
          estado: regla.maquina.estado,
        },
        regla: {
          id: regla.id,
          titulo: regla.titulo,
          categoria: regla.categoria,
          prioridad: regla.prioridad,
          tiempoEstimado: regla.tiempoEstimado,
          frecuencia: regla.frecuencia,
          intervaloDias: regla.intervaloDias,
          proximaFechaEjecucion: formatearFechaUTC(regla.proximaFechaEjecucion),
          activo: regla.activo,
          tecnicoResponsable: regla.tecnicoResponsable,
        },
        meses,
      };
    });

    const maquinasActivasSinRegla = await prisma.maquina.findMany({
      where: {
        estado: { notIn: ESTADOS_MAQUINA_OCULTOS },
        reglasRecurrencia: { none: { activo: true } },
      },
      select: { id: true, codigo: true, nombre: true, proceso: true, planta: true, area: true, estado: true },
      orderBy: [{ codigo: "asc" }],
      take: 100,
    });

    return res.json({
      success: true,
      year,
      total: rows.length,
      cobertura: {
        maquinasActivasSinRegla: maquinasActivasSinRegla.length,
        observacion: "Máquina activa sin regla preventiva mensual",
        maquinas: maquinasActivasSinRegla,
      },
      rows,
    });
  } catch (error) {
    console.error("[recurrencias] getMatrizRecurrencias error:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};
