import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, TipoTarea, ClasificacionTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { resolverRangoFechas } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_BACKLOG: EstadoTarea[] = [
  EstadoTarea.PENDIENTE,
  EstadoTarea.ASIGNADA,
  EstadoTarea.EN_PROGRESO,
  EstadoTarea.EN_PAUSA,
];

type FrecuenciaTicket = { cantidad: number; primeraFecha: Date; ultimaFecha: Date };

type MetricasBase = {
  totalTareas: number;
  tickets: number;
  correctivos: number;
  backlogActivo: number;
  tipos: Record<string, number>;
  estados: Record<string, number>;
  clasificaciones: Record<string, number>;
  categorias: Record<string, number>;
  tiemposCerradas: {
    cantidad: number;
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
  tickets: 0,
  correctivos: 0,
  backlogActivo: 0,
  tipos: {},
  estados: Object.values(EstadoTarea).reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {}),
  clasificaciones: {},
  categorias: {},
  tiemposCerradas: { cantidad: 0, tiempoRealTotal: 0, tiempoEstimadoTotal: 0 },
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

  const { cantidad, tiempoRealTotal, tiempoEstimadoTotal } = entry.tiemposCerradas;
  const tiempoPromedioRealMins = cantidad > 0 ? Math.round(tiempoRealTotal / cantidad) : 0;
  const tiempoPromedioEstimadoMins = cantidad > 0 ? Math.round(tiempoEstimadoTotal / cantidad) : 0;
  const desviacionPct = tiempoEstimadoTotal > 0
    ? Math.round(((tiempoRealTotal - tiempoEstimadoTotal) / tiempoEstimadoTotal) * 100)
    : null;
  const eficienciaPct = tiempoEstimadoTotal > 0
    ? Math.round((tiempoRealTotal / tiempoEstimadoTotal) * 100)
    : null;

  const { _frecuenciaRaw, _fechasTickets, ...rest } = entry;

  return {
    ...rest,
    tiemposCerradas: {
      ...rest.tiemposCerradas,
      tiempoPromedioRealMins,
      tiempoPromedioEstimadoMins,
      desviacionPct,
      eficienciaPct,
    },
    frecuenciaDiasPorTicket,
    frecuenciaTickets,
  };
};

export const getKpisArea = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } = req.query as any;
    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    const baseWhere: Prisma.TareaWhereInput = {};

    // Sanitización estricta: Evita que Axios envíe "null" o "undefined" como string y rompa la query.
    if (departamentoId && departamentoId !== "null" && departamentoId !== "undefined") {
      baseWhere.departamentoId = Number(departamentoId);
    }
    
    if (tecnicoId && tecnicoId !== "null" && tecnicoId !== "undefined") {
      baseWhere.responsables = { some: { id: Number(tecnicoId) } };
    }
    
    if (fechaInicio && fechaFin) {
      baseWhere.createdAt = { gte: fechaInicio, lte: fechaFin };
    }

    const tareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        tipo: true,
        clasificacion: true,
        estado: true,
        categoria: true,
        duracionReal: true,
        tiempoEstimado: true,
        planta: true,
        area: true,
        createdAt: true,
      },
    });

    // Log de diagnóstico corto y certero
    const conteoTicketsReales = tareas.filter(t => String(t.tipo) === "TICKET").length;
    console.log(`\n[DASHBOARD KPI] Tareas extraídas: ${tareas.length} | De las cuales TICKETS son: ${conteoTicketsReales}`);

    const plantaMap = new Map<string, PlantaEntry>();

    for (const t of tareas) {
      const pName = t.planta || "GENERAL";
      const aName = t.area || "GENERAL";
      const catName = t.categoria || "SIN_CATEGORIA";

      if (!plantaMap.has(pName)) {
        plantaMap.set(pName, { planta: pName, ...inicializarMetricas(), areasMap: new Map() });
      }
      const pEntry = plantaMap.get(pName)!;

      if (!pEntry.areasMap.has(aName)) {
        pEntry.areasMap.set(aName, { area: aName, ...inicializarMetricas() });
      }
      const aEntry = pEntry.areasMap.get(aName)!;

      const registrarDatos = (entry: MetricasBase) => {
        entry.totalTareas++;

        const safeTipo = t.tipo ? String(t.tipo).toUpperCase().trim() : "TICKET";
        entry.tipos[safeTipo] = (entry.tipos[safeTipo] || 0) + 1;

        if (safeTipo === "TICKET") {
          entry.tickets++;
        } else if (String(t.clasificacion).toUpperCase().trim() === "CORRECTIVO") {
          entry.correctivos++;
        }

        entry.estados[t.estado] = (entry.estados[t.estado] || 0) + 1;
        entry.clasificaciones[t.clasificacion] = (entry.clasificaciones[t.clasificacion] || 0) + 1;
        entry.categorias[catName] = (entry.categorias[catName] || 0) + 1;

        if (ESTADOS_BACKLOG.includes(t.estado)) {
          entry.backlogActivo++;
        }

        if (safeTipo === "TICKET") {
          entry._fechasTickets.push(t.createdAt);

          const freqKey = `${t.clasificacion}|${catName}`;
          if (!entry._frecuenciaRaw.has(freqKey)) {
            entry._frecuenciaRaw.set(freqKey, {
              cantidad: 0,
              primeraFecha: t.createdAt,
              ultimaFecha: t.createdAt,
            });
          }
          const fData = entry._frecuenciaRaw.get(freqKey)!;
          fData.cantidad++;
          if (t.createdAt < fData.primeraFecha) fData.primeraFecha = t.createdAt;
          if (t.createdAt > fData.ultimaFecha) fData.ultimaFecha = t.createdAt;
        }

        if (t.estado === EstadoTarea.CERRADO) {
          entry.tiemposCerradas.cantidad++;
          entry.tiemposCerradas.tiempoRealTotal += (t.duracionReal || 0);
          entry.tiemposCerradas.tiempoEstimadoTotal += (t.tiempoEstimado || 0);
        }
      };

      registrarDatos(pEntry);
      registrarDatos(aEntry);
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