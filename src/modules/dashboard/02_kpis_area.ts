import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import { resolverRangoFechas } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_BACKLOG: EstadoTarea[] = [
  EstadoTarea.PENDIENTE,
  EstadoTarea.ASIGNADA,
  EstadoTarea.EN_PROGRESO,
  EstadoTarea.EN_PAUSA,
];

export const getKpisArea = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } =
      req.query as unknown as DashboardFiltrosQuery;

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    const baseWhere: Prisma.TareaWhereInput = {};

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) return res.status(400).json({ error: "Usuario sin departamento." });
      baseWhere.departamentoId = user.departamentoId;
    }

    if (departamentoId && user.rol === Rol.SUPER_ADMIN) {
      baseWhere.departamentoId = departamentoId;
    }

    if (tecnicoId) {
      baseWhere.responsables = { some: { id: tecnicoId } };
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

    type FrecuenciaTicket = { cantidad: number; primeraFecha: Date; ultimaFecha: Date };
    
    type MetricasBase = {
      totalTareas: number;
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
    };

    type AreaEntry = MetricasBase & { area: string };
    type PlantaEntry = MetricasBase & { planta: string; areasMap: Map<string, AreaEntry> };

    const plantaMap = new Map<string, PlantaEntry>();

    const inicializarMetricas = (): MetricasBase => ({
      totalTareas: 0,
      backlogActivo: 0,
      tipos: {}, 
      estados: Object.values(EstadoTarea).reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {}),
      clasificaciones: {},
      categorias: {},
      tiemposCerradas: { cantidad: 0, tiempoRealTotal: 0, tiempoEstimadoTotal: 0 },
      _frecuenciaRaw: new Map(),
    });

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
        
        // Extracción infalible del tipo de tarea (Evita falsos nulos)
        const safeTipo = t.tipo ? String(t.tipo).toUpperCase().trim() : 'TICKET';
        entry.tipos[safeTipo] = (entry.tipos[safeTipo] || 0) + 1;
        
        entry.estados[t.estado] = (entry.estados[t.estado] || 0) + 1;
        entry.clasificaciones[t.clasificacion] = (entry.clasificaciones[t.clasificacion] || 0) + 1;
        entry.categorias[catName] = (entry.categorias[catName] || 0) + 1;

        if (ESTADOS_BACKLOG.includes(t.estado)) {
          entry.backlogActivo++;
        }

        if (safeTipo === "TICKET") {
          const freqKey = `${t.clasificacion}|${catName}`;
          if (!entry._frecuenciaRaw.has(freqKey)) {
            entry._frecuenciaRaw.set(freqKey, { cantidad: 0, primeraFecha: t.createdAt, ultimaFecha: t.createdAt });
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

    const formatearMetricas = (entry: MetricasBase) => {
      const frecuenciaTickets = Array.from(entry._frecuenciaRaw.entries()).map(([key, data]) => {
        const [clasificacion, categoria] = key.split("|");
        
        const spanMs = data.ultimaFecha.getTime() - data.primeraFecha.getTime();
        let spanDias = spanMs / (1000 * 60 * 60 * 24);
        if (spanDias < 1) spanDias = 1;

        const frecuenciaMensual = Number(((data.cantidad / spanDias) * 30).toFixed(1));

        return {
          clasificacion,
          categoria,
          cantidadTotal: data.cantidad,
          frecuenciaMensualEstimada: frecuenciaMensual
        };
      }).sort((a, b) => b.cantidadTotal - a.cantidadTotal);

      const { _frecuenciaRaw, ...rest } = entry;
      return { ...rest, frecuenciaTickets };
    };

    const metricasPorPlanta = Array.from(plantaMap.values()).map(p => ({
      planta: p.planta,
      ...formatearMetricas(p),
      areas: Array.from(p.areasMap.values()).map(a => ({
        area: a.area,
        ...formatearMetricas(a),
      })).sort((a, b) => b.totalTareas - a.totalTareas)
    })).sort((a, b) => b.totalTareas - a.totalTareas);

    return res.json({ status: "success", data: { metricasPorPlanta } });

  } catch (error) {
    await registrarError("DASHBOARD_KPIS_AREA", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs de Área." });
  }
};