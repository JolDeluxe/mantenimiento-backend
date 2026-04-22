// src/modules/dashboard/02_kpis_area.ts
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { resolverRangoFechas } from "./helper_metrics";
import { dashboardFiltrosSchema } from "./zod";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_ACTIVOS: EstadoTarea[] = [
  EstadoTarea.PENDIENTE,
  EstadoTarea.ASIGNADA,
  EstadoTarea.EN_PROGRESO,
  EstadoTarea.EN_PAUSA,
];

type FrecuenciaTicket = { cantidad: number; primeraFecha: Date; ultimaFecha: Date };

type MetricasBase = {
  totalTareas: number;
  tareasActivas: number;
  ticketsPeriodo: number; 
  desgloseActivas: Record<string, number>;
  tiposTotales: {
    tickets: number;
    planeadas: number;
    extraordinarias: number;
  };
  estados: Record<string, number>;
  clasificaciones: Record<string, number>;
  categorias: Record<string, number>;
  tiempos: {
    tiempoRealTotal: number;
    tiempoEstimadoTotal: number;
  };
  _frecuenciaRaw: Map<string, FrecuenciaTicket>;
  _fechasTickets: Date[];
};

type AreaEntry = MetricasBase & { area: string };
type PlantaEntry = MetricasBase & { planta: string; areasMap: Map<string, AreaEntry> };

const inicializarMetricas = (): MetricasBase => ({
  totalTareas: 0,
  tareasActivas: 0,
  ticketsPeriodo: 0,
  desgloseActivas: ESTADOS_ACTIVOS.reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {}),
  tiposTotales: { tickets: 0, planeadas: 0, extraordinarias: 0 },
  estados: Object.values(EstadoTarea).reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {}),
  clasificaciones: {},
  categorias: {},
  tiempos: { tiempoRealTotal: 0, tiempoEstimadoTotal: 0 },
  _frecuenciaRaw: new Map(),
  _fechasTickets: [],
});

const formatearMetricas = (entry: MetricasBase) => {
  // 1. Frecuencia Específica (Por Clasificación + Categoría)
  const frecuenciaTickets = Array.from(entry._frecuenciaRaw.entries()).map(([key, data]) => {
    const [clasificacion, categoria] = key.split("|");
    const spanMs = data.ultimaFecha.getTime() - data.primeraFecha.getTime();
    const spanDias = spanMs / (1000 * 60 * 60 * 24);

    let estadoFrecuencia: "NORMAL" | "UNICO" | "MISMO_DIA" = "NORMAL";
    let frecuenciaDias: number | null = null;

    if (data.cantidad === 1) {
      estadoFrecuencia = "UNICO";
    } else if (spanDias < 1) {
      estadoFrecuencia = "MISMO_DIA";
    } else {
      frecuenciaDias = Math.round(spanDias / (data.cantidad - 1));
    }

    return {
      clasificacion,
      categoria,
      cantidadTotal: data.cantidad,
      estadoFrecuencia,
      frecuenciaDias,
    };
  }).sort((a, b) => b.cantidadTotal - a.cantidadTotal);

  // 2. Frecuencia General (El promedio de TODOS los tickets del área)
  let generalEstadoFrecuencia: "NORMAL" | "UNICO" | "MISMO_DIA" | "SIN_DATOS" = "SIN_DATOS";
  let generalFrecuenciaDias: number | null = null;
  const totalHistoricoGeneral = entry._fechasTickets.length;

  if (totalHistoricoGeneral === 1) {
    generalEstadoFrecuencia = "UNICO";
  } else if (totalHistoricoGeneral > 1) {
    const sorted = [...entry._fechasTickets].sort((a, b) => a.getTime() - b.getTime());
    const primerTicket = sorted[0];
    const ultimoTicket = sorted[sorted.length - 1];

    // FIX: Validación de existencia para TypeScript Strict Mode
    if (primerTicket && ultimoTicket) {
      const spanMs = ultimoTicket.getTime() - primerTicket.getTime();
      const spanDias = spanMs / (1000 * 60 * 60 * 24);

      if (spanDias < 1) {
        generalEstadoFrecuencia = "MISMO_DIA";
      } else {
        generalEstadoFrecuencia = "NORMAL";
        generalFrecuenciaDias = Math.round(spanDias / (totalHistoricoGeneral - 1));
      }
    }
  }

  const { tiempoRealTotal, tiempoEstimadoTotal } = entry.tiempos;
  const alertaTiempo = tiempoEstimadoTotal > 0 && tiempoRealTotal > (tiempoEstimadoTotal * 1.15);

  const { _frecuenciaRaw, _fechasTickets, ...rest } = entry;

  return {
    ...rest,
    tiempos: { tiempoRealTotal, tiempoEstimadoTotal, alertaTiempo },
    frecuenciaGeneral: {
      totalHistorico: totalHistoricoGeneral,
      estadoFrecuencia: generalEstadoFrecuencia,
      frecuenciaDias: generalFrecuenciaDias,
    },
    frecuenciaTickets,
  };
};

export const getKpisArea = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const query = dashboardFiltrosSchema.shape.query.parse(req.query);
    const { fechaInicio, fechaFin } = resolverRangoFechas(query.year, query.month, query.fechaInicio, query.fechaFin);

    const globalWhere: Prisma.TareaWhereInput = { estado: { not: EstadoTarea.CANCELADA } };
    if (query.departamentoId) globalWhere.departamentoId = query.departamentoId;
    if (query.tecnicoId) globalWhere.responsables = { some: { id: query.tecnicoId } };

    const periodoWhere: Prisma.TareaWhereInput = { ...globalWhere };
    if (fechaInicio && fechaFin) periodoWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    const [tareasGlobales, tareasPeriodo] = await Promise.all([
      prisma.tarea.findMany({
        where: globalWhere,
        select: { planta: true, area: true, tipo: true, createdAt: true, clasificacion: true, categoria: true }, 
      }),
      prisma.tarea.findMany({
        where: periodoWhere,
        select: {
          tipo: true, clasificacion: true, estado: true, categoria: true,
          duracionReal: true, tiempoEstimado: true, planta: true, area: true, createdAt: true,
        },
      })
    ]);

    const plantaMap = new Map<string, PlantaEntry>();

    for (const t of tareasGlobales) {
      const pName = t.planta || "GENERAL";
      const aName = t.area || "GENERAL";
      const catName = t.categoria || "SIN_CATEGORIA";

      if (!plantaMap.has(pName)) plantaMap.set(pName, { planta: pName, ...inicializarMetricas(), areasMap: new Map() });
      const pEntry = plantaMap.get(pName)!;
      if (!pEntry.areasMap.has(aName)) pEntry.areasMap.set(aName, { area: aName, ...inicializarMetricas() });
      const aEntry = pEntry.areasMap.get(aName)!;

      const safeTipo = t.tipo ? String(t.tipo).toUpperCase().trim() : "TICKET";
      
      const incrementarHistorico = (entry: MetricasBase) => {
        if (safeTipo === "TICKET") {
          entry._fechasTickets.push(t.createdAt);
          const freqKey = `${t.clasificacion}|${catName}`;
          if (!entry._frecuenciaRaw.has(freqKey)) {
            entry._frecuenciaRaw.set(freqKey, { cantidad: 0, primeraFecha: t.createdAt, ultimaFecha: t.createdAt });
          }
          const fData = entry._frecuenciaRaw.get(freqKey)!;
          fData.cantidad++;
          if (t.createdAt < fData.primeraFecha) fData.primeraFecha = t.createdAt;
          if (t.createdAt > fData.ultimaFecha) fData.ultimaFecha = t.createdAt;
        }
      };
      
      incrementarHistorico(pEntry);
      incrementarHistorico(aEntry);
    }

    for (const t of tareasPeriodo) {
      const pName = t.planta || "GENERAL";
      const aName = t.area || "GENERAL";
      const catName = t.categoria || "SIN_CATEGORIA";
      
      const pEntry = plantaMap.get(pName)!;
      const aEntry = pEntry.areasMap.get(aName)!;

      const safeTipo = t.tipo ? String(t.tipo).toUpperCase().trim() : "TICKET";

      const registrarPeriodo = (entry: MetricasBase) => {
        entry.totalTareas++;

        if (safeTipo === "TICKET") {
            entry.ticketsPeriodo++; 
            entry.tiposTotales.tickets++;
        } else if (safeTipo === "PLANEADA") {
            entry.tiposTotales.planeadas++;
        } else {
            entry.tiposTotales.extraordinarias++;
        }

        entry.estados[t.estado] = (entry.estados[t.estado] || 0) + 1;
        entry.clasificaciones[t.clasificacion] = (entry.clasificaciones[t.clasificacion] || 0) + 1;
        entry.categorias[catName] = (entry.categorias[catName] || 0) + 1;

        if (ESTADOS_ACTIVOS.includes(t.estado)) {
          entry.tareasActivas++;
          entry.desgloseActivas[t.estado] = (entry.desgloseActivas[t.estado] || 0) + 1;
        }

        entry.tiempos.tiempoRealTotal += (t.duracionReal || 0);
        entry.tiempos.tiempoEstimadoTotal += (t.tiempoEstimado || 0);
      };

      registrarPeriodo(pEntry);
      registrarPeriodo(aEntry);
    }

    const metricasPorPlanta = Array.from(plantaMap.values()).map(p => ({
      planta: p.planta,
      ...formatearMetricas(p),
      areas: Array.from(p.areasMap.values())
        .map(a => ({ area: a.area, ...formatearMetricas(a) }))
        .sort((a, b) => b.totalTareas - a.totalTareas),
    })).sort((a, b) => b.totalTareas - a.totalTareas);

    return res.json({ status: "success", data: { metricasPorPlanta } });

  } catch (error) {
    await registrarError("DASHBOARD_KPIS_AREA", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs de Área." });
  }
};