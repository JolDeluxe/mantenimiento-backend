import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, ClasificacionTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { getTicketFilters, isAdminOrJefe } from "./helper";
import type { TicketFilterQuery } from "./zod";

export const obtenerMetricasTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    
    const baseWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);
    
    if (!query.estado) {
      baseWhere.estado = { not: EstadoTarea.CANCELADA };
    }

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const whereSinEstado: Prisma.TareaWhereInput = {
      ...getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado),
      estado: { not: EstadoTarea.CANCELADA }
    };

    const globalWhere: Prisma.TareaWhereInput = {
      ...getTicketFilters({ id: user.id, rol: user.rol }, {
        page: 1,
        limit: 100,
        sort: [{ createdAt: 'desc' }]
      }),
      estado: { not: EstadoTarea.CANCELADA }
    };

    // Propagar la búsqueda en texto para que las métricas reaccionen a la UI
    if (query.q) {
      const searchStr = query.q.trim();
      const searchFilter = {
        OR: [
          { titulo: { contains: searchStr } },
          { area: { contains: searchStr } },
          ...( !isNaN(Number(searchStr)) ? [{ id: Number(searchStr) }] : [] )
        ]
      };

      baseWhere.AND = [
        ...(Array.isArray(baseWhere.AND) ? baseWhere.AND : (baseWhere.AND ? [baseWhere.AND] : [])),
        searchFilter
      ];
      whereSinEstado.AND = [
        ...(Array.isArray(whereSinEstado.AND) ? whereSinEstado.AND : (whereSinEstado.AND ? [whereSinEstado.AND] : [])),
        searchFilter
      ];
    }

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
      conteoGlobalEstados,
      conteoPorTipo, 
      conteoPorCategoria, 
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
      prisma.tarea.count({ where: whereSinEstado }),
      prisma.tarea.groupBy({ 
        by: ['estado'], 
        where: whereSinEstado, 
        _count: { estado: true } 
      }),
      prisma.tarea.groupBy({
        by: ['estado'],
        where: globalWhere,
        _count: { estado: true }
      }),
      prisma.tarea.groupBy({ by: ['tipo'], where: baseWhere, _count: { tipo: true } }),
      prisma.tarea.groupBy({ by: ['categoria'], where: baseWhere, _count: { categoria: true } }), 
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfMonth } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfWeek } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfDay } } }),
      prisma.tarea.count({ 
        where: { 
          ...globalWhere, 
          fechaVencimiento: { lt: now },
          estado: { in: activeStates }
        } 
      }),
      prisma.tarea.aggregate({
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),
      prisma.tarea.groupBy({
        by: ['tipo'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),
      prisma.tarea.groupBy({
        by: ['clasificacion'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
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
      prisma.tarea.count({
        where: { ...baseWhere, estado: EstadoTarea.PENDIENTE, responsables: { none: {} } }
      }),
      prisma.tarea.groupBy({
        by: ['prioridad'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
        },
        _avg: { tiempoEstimado: true, duracionReal: true }
      }),
      prisma.tarea.groupBy({
        by: ['planta', 'area'],
        where: baseWhere,
        _count: { _all: true }
      }),
      prisma.tarea.findMany({
        where: {
          ...baseWhere,
          estado: { in: closedStates },
          tiempoEstimado: { not: null }
        },
        select: { tiempoEstimado: true, duracionReal: true }
      }),
      prisma.intervaloTiempo.aggregate({
        where: {
          tarea: baseWhere,
          estado: EstadoTarea.EN_PAUSA
        },
        _sum: { duracion: true }
      })
    ]);

    const resumenEstatus = conteoPorEstado.reduce((acc, curr) => ({ 
      ...acc, [curr.estado]: curr._count.estado 
    }), {} as Record<string, number>);

    const resumenGlobalEstatus = conteoGlobalEstados.reduce((acc, curr) => ({ 
      ...acc, [curr.estado]: curr._count.estado 
    }), {} as Record<string, number>);

    const resumenTipo = conteoPorTipo.reduce((acc, curr) => ({ 
      ...acc, [curr.tipo]: curr._count.tipo 
    }), {} as Record<string, number>);

    const resumenCategoria = conteoPorCategoria.reduce((acc, curr) => {
      const key = curr.categoria || "Sin Categoría";
      return { ...acc, [key]: curr._count.categoria };
    }, {} as Record<string, number>);

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

    const topFocosRojos = focosRojosData
      .map(f => ({
        planta: f.planta,
        area: f.area || "General",
        cantidad: f._count._all
      }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

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
    const porcentajeATiempo = totalCumplimiento > 0 
      ? Math.round((aTiempo / totalCumplimiento) * 100) 
      : 0;

    const workload = tecnicosRaw.map(t => ({
      id: t.id,
      nombre: t.nombre,
      cantidadActivas: t.tareasAsignadas.length,
      minutosEstimadosPendientes: t.tareasAsignadas.reduce(
        (sum, tarea) => sum + (tarea.tiempoEstimado || 0), 0
      )
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
        existenciaGlobal: resumenGlobalEstatus, 
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
          porCategoria: resumenCategoria,
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