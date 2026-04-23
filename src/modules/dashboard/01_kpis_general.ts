import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import {
  calcularKpiTarea,
  calcularKpiAgregado,
  colorParaKpi,
  resolverRangoFechas,
  toMXDateStr,
} from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
const ESTADOS_ACTIVAS: EstadoTarea[] = [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];

const toPct = (val: number, total: number) => total > 0 ? Number(((val / total) * 100).toFixed(2)) : 0;

export const getKpisGeneral = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } = req.query as unknown as DashboardFiltrosQuery;
    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    // 🔥 Ignoramos las canceladas por defecto
    const baseWhere: Prisma.TareaWhereInput = {
      estado: { not: EstadoTarea.CANCELADA }
    };

    // 🔥 NUEVA REGLA DE NEGOCIO:
    // El Jefe y Coordinador ven TODO. No hay filtros de departamento para ellos.
    // Solo limitamos si es un SUPER_ADMIN usando el selector de departamentos.
    if (user.rol === Rol.SUPER_ADMIN && departamentoId) {
      baseWhere.departamentoId = departamentoId;
    }

    if (tecnicoId) baseWhere.responsables = { some: { id: tecnicoId } };
    if (fechaInicio && fechaFin) baseWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    const todasLasTareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        id: true, tipo: true, estado: true,
        finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        clasificacion: true, categoria: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
      },
    });

    const totalGeneradas = todasLasTareas.length;
    const tareasTerminadas = todasLasTareas.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
    const tareasActivasLista = todasLasTareas.filter(t => ESTADOS_ACTIVAS.includes(t.estado));

    const kpisIndividuales = tareasTerminadas.map((t) => calcularKpiTarea(t as any));
    const { kpiPromedio: kpiGlobal, datosSuficientes: kpiDatosSuficientes } = calcularKpiAgregado(kpisIndividuales);

    const totalTerminadas = tareasTerminadas.length;
    const conRechazos = tareasTerminadas.filter((t) => t.historial.length > 0).length;
    const aprobadasALaPrimera = totalTerminadas - conRechazos;
    const tasaAceptacion = toPct(aprobadasALaPrimera, totalTerminadas);

    const conFecha = tareasTerminadas.filter((t) => t.finalizadoAt && t.fechaVencimiento);
    const aTiempoCount = conFecha.filter((t) =>
    toMXDateStr(new Date(t.finalizadoAt!)) <= toMXDateStr(new Date(t.fechaVencimiento!))
).length;
const tardeCount = conFecha.filter((t) =>
    toMXDateStr(new Date(t.finalizadoAt!)) > toMXDateStr(new Date(t.fechaVencimiento!))
).length;
    const indiceCumplimiento = conFecha.length > 0 ? toPct(aTiempoCount, conFecha.length) : null;

    const conTiempos = tareasTerminadas.filter((t) => t.duracionReal != null && t.tiempoEstimado != null && t.tiempoEstimado > 0);
    const excedidasCount = conTiempos.filter((t) => t.duracionReal! > t.tiempoEstimado!).length;
    const deAcuerdoCount = conTiempos.filter((t) => t.duracionReal! <= t.tiempoEstimado!).length;

    let totalDuracionReal = 0;
    let totalDuracionEstimada = 0;

    tareasTerminadas.forEach(t => {
      if (t.tiempoEstimado && t.tiempoEstimado > 0) {
        totalDuracionEstimada += t.tiempoEstimado;
        totalDuracionReal += (t.duracionReal || 0);
      }
    });

    let desviacionEstimacionGlobal: number | null = null;
    if (totalDuracionEstimada > 0) {
       desviacionEstimacionGlobal = Number((((totalDuracionReal - totalDuracionEstimada) / totalDuracionEstimada) * 100).toFixed(2));
    }

    let desviacionColor = "neutral";
    if (desviacionEstimacionGlobal !== null) {
       if (desviacionEstimacionGlobal <= 10) desviacionColor = "verde";
       else if (desviacionEstimacionGlobal <= 30) desviacionColor = "ambar";
       else desviacionColor = "rojo";
    }

    const rendimiento = {
      aTiempo: { cantidad: aTiempoCount, porcentaje: toPct(aTiempoCount, conFecha.length) },
      tarde: { cantidad: tardeCount, porcentaje: toPct(tardeCount, conFecha.length) },
      excedidas: { cantidad: excedidasCount, porcentaje: toPct(excedidasCount, conTiempos.length) },
      deAcuerdo: { cantidad: deAcuerdoCount, porcentaje: toPct(deAcuerdoCount, conTiempos.length) }
    };

    const tiposMap: Record<string, number> = { TICKET: 0, PLANEADA: 0, EXTRAORDINARIA: 0 };
    todasLasTareas.forEach(t => {
       const tipoStr = t.tipo.toString();
       tiposMap[tipoStr] = (tiposMap[tipoStr] || 0) + 1;
    });
    const tipos = Object.entries(tiposMap).map(([nombre, cantidad]) => ({
       nombre,
       cantidad,
       porcentaje: toPct(cantidad, totalGeneradas)
    })).sort((a, b) => b.cantidad - a.cantidad);

    const clasiMap: Record<string, number> = {};
    todasLasTareas.forEach(t => {
       const c = t.clasificacion || "SIN CLASIFICAR";
       clasiMap[c] = (clasiMap[c] || 0) + 1;
    });
    const topClasificaciones = Object.entries(clasiMap)
       .sort((a, b) => b[1] - a[1])
       .slice(0, 5)
       .map(([nombre, cantidad]) => ({
           nombre,
           cantidad,
           porcentaje: toPct(cantidad, totalGeneradas)
       }));

    const catMap: Record<string, number> = {};
    todasLasTareas.forEach(t => {
       const c = t.categoria || "SIN CATEGORÍA";
       catMap[c] = (catMap[c] || 0) + 1;
    });
    const topCategorias = Object.entries(catMap)
       .sort((a, b) => b[1] - a[1])
       .slice(0, 5)
       .map(([nombre, cantidad]) => ({
           nombre,
           cantidad,
           porcentaje: toPct(cantidad, totalGeneradas)
       }));

    const activasMap: Record<string, number> = {};
    tareasActivasLista.forEach(t => {
       activasMap[t.estado] = (activasMap[t.estado] || 0) + 1;
    });
    const activas = {
       total: tareasActivasLista.length,
       desglose: Object.entries(activasMap)
         .map(([estado, cantidad]) => ({
            estado: estado.replace('_', ' '),
            cantidad,
            porcentaje: toPct(cantidad, tareasActivasLista.length)
         }))
         .sort((a, b) => b.cantidad - a.cantidad)
    };

    return res.json({
      status: "success",
      data: {
        resumen: {
          totalGeneradas,
          totalTerminadas,
          kpiGlobal: Number(kpiGlobal.toFixed(2)),
          kpiColor: colorParaKpi(kpiGlobal),
          kpiDatosSuficientes,
          tasaAceptacion,
          tasaAceptacionColor: colorParaKpi(tasaAceptacion),
          indiceCumplimiento,
          indiceCumplimientoColor: indiceCumplimiento !== null ? colorParaKpi(indiceCumplimiento) : null,
          desviacionEstimacionGlobal,
          desviacionColor
        },
        rendimiento,
        activas,
        tipos,
        topCategorias,
        topClasificaciones
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_KPIS_GENERAL", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs Generales." });
  }
};