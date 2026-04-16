import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prioridad, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import {
  calcularKpiTarea,
  calcularKpiAgregado,
  colorParaKpi,
  resolverRangoFechas,
} from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
const ESTADOS_BACKLOG: EstadoTarea[] = [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];

export const getKpisGeneral = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } =
      req.query as unknown as DashboardFiltrosQuery;

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    // 1. BASE WHERE (Buscamos TODAS las tareas del periodo, no solo las terminadas)
    const baseWhere: Prisma.TareaWhereInput = {};

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) return res.status(400).json({ error: "Usuario sin departamento." });
      baseWhere.departamentoId = user.departamentoId;
    }

    if (departamentoId && user.rol === Rol.SUPER_ADMIN) baseWhere.departamentoId = departamentoId;
    if (tecnicoId) baseWhere.responsables = { some: { id: tecnicoId } };
    if (fechaInicio && fechaFin) baseWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    // 2. CONSULTA PRINCIPAL
    const todasLasTareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        id: true, titulo: true, descripcion: true, tipo: true, estado: true, prioridad: true,
        finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        planta: true, area: true, clasificacion: true, categoria: true, createdAt: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
      },
    });

    // Separación Lógica
    const tareasTerminadas = todasLasTareas.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
    const tareasBacklog = todasLasTareas.filter(t => ESTADOS_BACKLOG.includes(t.estado));

    // 3. MÉTRICAS DE RENDIMIENTO GLOBAL (Solo aplica para las Terminadas)
    const kpisIndividuales = tareasTerminadas.map((t) => calcularKpiTarea(t));
    const { kpiPromedio: kpiGlobal, datosSuficientes: kpiDatosSuficientes } = calcularKpiAgregado(kpisIndividuales);

    // Tasa Global de Aceptación vs Rechazo
    const totalTerminadas = tareasTerminadas.length;
    const conRechazos = tareasTerminadas.filter((t) => t.historial.length > 0).length;
    const aprobadasALaPrimera = totalTerminadas - conRechazos;
    const tasaAceptacion = totalTerminadas > 0 ? Math.round((aprobadasALaPrimera / totalTerminadas) * 100) : 0;

    // SLA (Cumplimiento de Fechas)
    const conFecha = tareasTerminadas.filter((t) => t.finalizadoAt && t.fechaVencimiento);
    const aTiempo = conFecha.filter((t) => t.finalizadoAt! <= t.fechaVencimiento!).length;
    const slaRate = conFecha.length > 0 ? Math.round((aTiempo / conFecha.length) * 100) : null;

    // Tiempos y Eficiencia Global
    let totalDuracionReal = 0;
    let totalDuracionEstimada = 0;
    let sumaRealParaPromedio = 0;

    tareasTerminadas.forEach(t => {
      sumaRealParaPromedio += (t.duracionReal || 0);
      if (t.tiempoEstimado && t.tiempoEstimado > 0) {
        totalDuracionEstimada += t.tiempoEstimado;
        totalDuracionReal += (t.duracionReal || 0);
      }
    });

    const tiempoPromedioCierreMins = totalTerminadas > 0 ? Math.round(sumaRealParaPromedio / totalTerminadas) : 0;
    const eficienciaEstimacionGlobal = totalDuracionEstimada > 0 ? Math.round((totalDuracionReal / totalDuracionEstimada) * 100) : null;

    // 4. DISTRIBUCIONES (Para gráficas generales)
    const distribuciones = {
      estados: Object.values(EstadoTarea).reduce((acc, e) => ({ ...acc, [e]: 0 }), {} as Record<EstadoTarea, number>),
      prioridades: Object.values(Prioridad).reduce((acc, p) => ({ ...acc, [p]: 0 }), {} as Record<Prioridad, number>),
      clasificaciones: {} as Record<string, number>,
      categorias: {} as Record<string, number>,
    };

    todasLasTareas.forEach(t => {
      distribuciones.estados[t.estado] = (distribuciones.estados[t.estado] || 0) + 1;
      distribuciones.prioridades[t.prioridad] = (distribuciones.prioridades[t.prioridad] || 0) + 1;
      distribuciones.clasificaciones[t.clasificacion] = (distribuciones.clasificaciones[t.clasificacion] || 0) + 1;
      
      const cat = t.categoria || "SIN_CATEGORIA";
      distribuciones.categorias[cat] = (distribuciones.categorias[cat] || 0) + 1;
    });

    // 5. CARGA VIVA (Backlog)
    const backlog = {
      totalActivo: tareasBacklog.length,
      desglose: Object.values(EstadoTarea)
        .filter(e => ESTADOS_BACKLOG.includes(e))
        .reduce((acc, e) => ({ ...acc, [e]: distribuciones.estados[e] }), {} as Record<string, number>)
    };

    // 6. TICKETS RECIENTES (Evaluados)
    const ticketsEvaluados = tareasTerminadas
      .filter((t) => t.tipo === "TICKET")
      .map((t) => ({
        id: t.id, titulo: t.titulo, descripcion: t.descripcion, planta: t.planta,
        area: t.area, clasificacion: t.clasificacion, estado: t.estado, prioridad: t.prioridad,
        fechaFinalizado: t.finalizadoAt, kpi: calcularKpiTarea(t), colorKpi: colorParaKpi(calcularKpiTarea(t)),
      }))
      .sort((a, b) => (b.fechaFinalizado?.getTime() || 0) - (a.fechaFinalizado?.getTime() || 0))
      .slice(0, 50);

    // 7. AÑOS DISPONIBLES (Para el filtro del frontend)
    const aniosConDatos = await prisma.tarea.groupBy({
      by: ["createdAt"],
      where: {
        ...(user.rol !== Rol.SUPER_ADMIN ? { departamentoId: user.departamentoId! } : {}),
      },
      _count: { id: true },
    });
    const aniosDisponibles = Array.from(new Set(aniosConDatos.map((r) => r.createdAt.getFullYear()))).sort((a, b) => b - a);

    // --- RESPUESTA JSON ---
    return res.json({
      status: "success",
      data: {
        resumen: {
          totalGeneradas: todasLasTareas.length,
          totalTerminadas,
          kpiGlobal,
          kpiColor: colorParaKpi(kpiGlobal),
          kpiDatosSuficientes,
          tasaAceptacion, // Qué porcentaje pasó sin rechazos
          tasaAceptacionColor: colorParaKpi(tasaAceptacion),
          slaRate,
          slaColor: slaRate !== null ? colorParaKpi(slaRate) : null,
          tiempoPromedioCierreMins,
          eficienciaEstimacionGlobal // Cerca de 100% es perfecto. >100% se tardaron más de lo planeado.
        },
        backlog,
        distribuciones,
        ticketsEvaluados,
        aniosDisponibles,
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_KPIS_GENERAL", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs Generales." });
  }
};