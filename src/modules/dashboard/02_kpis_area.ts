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
  tiposTotales: { // GLOBAL HISTÓRICO
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
  const frecuenciaTickets = Array.from(entry._frecuenciaRaw.entries()).map(([key, data]) => {
    const [clasificacion, categoria] = key.split("|");
    const spanMs = data.ultimaFecha.getTime() - data.primeraFecha.getTime();
    let spanDias = spanMs / (1000 * 60 * 60 * 24);
    if (spanDias < 1) spanDias = 1;

    const frecuenciaDias = data.cantidad > 1
      ? Number((spanDias / (data.cantidad - 1)).toFixed(1))
      : null;

    const frecuenciaMensual = Number(((data.cantidad / spanDias) * 30).toFixed(1));

    return {
      clasificacion,
      categoria,
      cantidadTotal: data.cantidad,
      frecuenciaDias,
      frecuenciaMensualEstimada: frecuenciaMensual,
    };
  }).sort((a, b) => b.cantidadTotal - a.cantidadTotal);

  let frecuenciaDiasPorTicket: number | null = null;
  if (entry._fechasTickets.length > 1) {
    const sorted = [...entry._fechasTickets].sort((a, b) => a.getTime() - b.getTime());
    const primerTicket = sorted[0];
    const ultimoTicket = sorted[sorted.length - 1];

    if (primerTicket && ultimoTicket) {
      const spanDias = (ultimoTicket.getTime() - primerTicket.getTime()) / (1000 * 60 * 60 * 24);
      frecuenciaDiasPorTicket = spanDias > 0
        ? Number((spanDias / (entry._fechasTickets.length - 1)).toFixed(1))
        : null;
    }
  }

  const { tiempoRealTotal, tiempoEstimadoTotal } = entry.tiempos;
  const alertaTiempo = tiempoEstimadoTotal > 0 && tiempoRealTotal > (tiempoEstimadoTotal * 1.15);

  const { _frecuenciaRaw, _fechasTickets, ...rest } = entry;

  return {
    ...rest,
    tiempos: { tiempoRealTotal, tiempoEstimadoTotal, alertaTiempo },
    frecuenciaDiasPorTicket,
    frecuenciaTickets,
  };
};

export const getKpisArea = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const query = dashboardFiltrosSchema.shape.query.parse(req.query);
    const { fechaInicio, fechaFin } = resolverRangoFechas(query.year, query.month, query.fechaInicio, query.fechaFin);

    // 1. QUERY GLOBAL (Sin filtro de fechas)
    const globalWhere: Prisma.TareaWhereInput = { estado: { not: EstadoTarea.CANCELADA } };
    if (query.departamentoId) globalWhere.departamentoId = query.departamentoId;
    if (query.tecnicoId) globalWhere.responsables = { some: { id: query.tecnicoId } };

    // 2. QUERY PERIODO (Con filtro de fechas)
    const periodoWhere: Prisma.TareaWhereInput = { ...globalWhere };
    if (fechaInicio && fechaFin) periodoWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    // Ejecutamos ambas consultas
    // NOTA: A la global ahora le pedimos 'createdAt', 'clasificacion' y 'categoria' para armar la frecuencia
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

    // Paso A: HISTÓRICO GLOBAL (Tipos y Frecuencias)
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
          entry.tiposTotales.tickets++;
          
          // 🚨 AHORA LA FRECUENCIA SE CALCULA AQUÍ EN EL BUCLE GLOBAL 🚨
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
        else if (safeTipo === "PLANEADA") entry.tiposTotales.planeadas++;
        else entry.tiposTotales.extraordinarias++;
      };
      
      incrementarHistorico(pEntry);
      incrementarHistorico(aEntry);
    }

    // Paso B: PERIODO SELECCIONADO (Estados y Tiempos)
    for (const t of tareasPeriodo) {
      const pName = t.planta || "GENERAL";
      const aName = t.area || "GENERAL";
      const catName = t.categoria || "SIN_CATEGORIA";
      
      const pEntry = plantaMap.get(pName)!;
      const aEntry = pEntry.areasMap.get(aName)!;

      const safeTipo = t.tipo ? String(t.tipo).toUpperCase().trim() : "TICKET";

      const registrarPeriodo = (entry: MetricasBase) => {
        entry.totalTareas++;

        if (safeTipo === "TICKET") entry.ticketsPeriodo++; 

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