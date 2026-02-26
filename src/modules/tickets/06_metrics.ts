import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, ClasificacionTarea } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { getTicketFilters, isAdminOrJefe } from "./helper";
import type { TicketFilterQuery } from "./zod";

export const obtenerMetricasTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    const baseWhere = getTicketFilters({ id: user.id, rol: user.rol }, query);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); 
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const activeStates = [
      EstadoTarea.PENDIENTE,
      EstadoTarea.ASIGNADA,
      EstadoTarea.EN_PROGRESO,
      EstadoTarea.EN_PAUSA
    ];

    const closedStates = [
      EstadoTarea.RESUELTO,
      EstadoTarea.CERRADO
    ];

    const [
      total, 
      conteoPorEstado, 
      conteoPorTipo, 
      countMonth, 
      countWeek, 
      countDay, 
      backlogVencidas,
      eficaciaGeneral,
      eficaciaPorTipoData,
      eficaciaPorClasificacionData,
      tecnicosRaw,
      huerfanos,
      eficaciaPorPrioridadData,
      focosRojosData,
      cumplimientoData,
      pausaData
    ] = await Promise.all([
      // Métricas Originales
      prisma.tarea.count({ where: baseWhere }),
      prisma.tarea.groupBy({ by: ['estado'], where: baseWhere, _count: { estado: true } }),
      prisma.tarea.groupBy({ by: ['tipo'], where: baseWhere, _count: { tipo: true } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfMonth } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfWeek } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfDay } } }),
      
      prisma.tarea.count({ 
        where: { 
          ...baseWhere, 
          fechaVencimiento: { lt: now },
          estado: { in: activeStates }
        } 
      }),
      
      prisma.tarea.aggregate({
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA } 
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),

      prisma.tarea.groupBy({
        by: ['tipo'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA } 
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),

      prisma.tarea.groupBy({
        by: ['clasificacion'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA } 
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),

      isAdminOrJefe(user.rol)
        ? prisma.usuario.findMany({
            where: { rol: Rol.TECNICO, estado: "ACTIVO" },
            select: { 
              id: true, 
              nombre: true, 
              tareasAsignadas: { 
                where: { ...baseWhere, estado: { in: activeStates } },
                select: { id: true, tiempoEstimado: true }
              } 
            }
          })
        : Promise.resolve([]),

      // NUEVO: 1. Tickets Huérfanos
      prisma.tarea.count({
        where: { ...baseWhere, estado: EstadoTarea.PENDIENTE, responsables: { none: {} } }
      }),

      // NUEVO: 2. Eficacia por Prioridad
      prisma.tarea.groupBy({
        by: ['prioridad'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA } 
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),

      // NUEVO: 3. Focos Rojos (Agrupación por Planta y Área)
      prisma.tarea.groupBy({
        by: ['planta', 'area'],
        where: baseWhere,
        _count: { _all: true }
      }),

      // NUEVO: 4. Extracción de Tiempos para Cumplimiento (Solo carga 2 campos numéricos por eficiencia)
      prisma.tarea.findMany({
        where: {
          ...baseWhere,
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA },
          tiempoEstimado: { not: null }
        },
        select: { tiempoEstimado: true, duracionReal: true }
      }),

      // NUEVO: 5. Sumatoria de Tiempo en Pausa
      prisma.intervaloTiempo.aggregate({
        where: {
          tarea: baseWhere,
          estado: EstadoTarea.EN_PAUSA
        },
        _sum: { duracion: true }
      })
    ]);

    // Procesamiento de Volumetría
    const resumenEstatus = conteoPorEstado.reduce((acc, curr) => ({ ...acc, [curr.estado]: curr._count.estado }), {});
    const resumenTipo = conteoPorTipo.reduce((acc, curr) => ({ ...acc, [curr.tipo]: curr._count.tipo }), {});

    // Procesamiento de Eficacias (Tiempos)
    const eficaciaPorTipo = eficaciaPorTipoData.reduce((acc, curr) => ({
      ...acc, [curr.tipo]: {
        promedioEstimadoMins: Math.round(curr._avg.tiempoEstimado || 0),
        promedioRealMins: Math.round(curr._avg.duracionReal || 0)
      }
    }), {});

    const eficaciaPorClasificacion = eficaciaPorClasificacionData.reduce((acc, curr) => ({
      ...acc, [curr.clasificacion]: {
        promedioEstimadoMins: Math.round(curr._avg.tiempoEstimado || 0),
        promedioRealMins: Math.round(curr._avg.duracionReal || 0)
      }
    }), {});

    const eficaciaPorPrioridad = eficaciaPorPrioridadData.reduce((acc, curr) => ({
      ...acc, [curr.prioridad]: {
        promedioEstimadoMins: Math.round(curr._avg.tiempoEstimado || 0),
        promedioRealMins: Math.round(curr._avg.duracionReal || 0)
      }
    }), {});

    // Procesamiento de Focos Rojos (Ordena de mayor a menor y extrae el Top 5)
    const topFocosRojos = focosRojosData
      .map(f => ({
        planta: f.planta,
        area: f.area || "General",
        cantidad: f._count._all
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    // Procesamiento de Cumplimiento
    let aTiempo = 0;
    let atrasados = 0;
    cumplimientoData.forEach(t => {
      if ((t.duracionReal || 0) <= (t.tiempoEstimado || 0)) {
        aTiempo++;
      } else {
        atrasados++;
      }
    });
    const totalCumplimiento = aTiempo + atrasados;
    const porcentajeATiempo = totalCumplimiento > 0 ? Math.round((aTiempo / totalCumplimiento) * 100) : 0;

    // Procesamiento de Carga de Trabajo
    const workload = tecnicosRaw.map(t => ({
      id: t.id,
      nombre: t.nombre,
      cantidadActivas: t.tareasAsignadas.length,
      minutosEstimadosPendientes: t.tareasAsignadas.reduce((sum, tarea) => sum + (tarea.tiempoEstimado || 0), 0)
    }));

    return res.json({
      status: "success",
      data: {
        global: {
          total: total,
          backlogAtrasado: backlogVencidas,
          huerfanos: huerfanos,
          minutosTotalesPausa: pausaData._sum.duracion || 0
        },
        eficacia: {
          general: {
            promedioEstimadoMins: Math.round(eficaciaGeneral._avg.tiempoEstimado || 0),
            promedioRealMins: Math.round(eficaciaGeneral._avg.duracionReal || 0)
          },
          porTipo: eficaciaPorTipo,
          porClasificacion: eficaciaPorClasificacion,
          porPrioridad: eficaciaPorPrioridad
        },
        cumplimiento: {
          aTiempo: aTiempo,
          atrasados: atrasados,
          porcentajeATiempo: porcentajeATiempo
        },
        distribucion: {
          porEstado: resumenEstatus,
          porTipo: resumenTipo,
          focosRojos: topFocosRojos
        },
        periodo: {
          mes: countMonth,
          semana: countWeek,
          hoy: countDay
        },
        workload: workload
      }
    });

  } catch (error) {
    await registrarError('GET_TICKET_METRICS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al calcular métricas" });
  }
};