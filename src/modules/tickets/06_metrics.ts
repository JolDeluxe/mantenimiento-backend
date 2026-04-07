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
    
    // ── 1. FILTROS DE SEGURIDAD Y CONTEXTO ───────────────────────────────────
    
    // Filtro Estricto: Reacciona a búsqueda, tipo, prioridad y tab de estado
    const baseWhere = getTicketFilters({ id: user.id, rol: user.rol }, query);

    // Filtro Estático: Ignora el "estado" para que la SummaryBar no colapse a 0
    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const whereSinEstado = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);

    // 🔥 CORRECCIÓN: Filtro Global con valores por defecto para satisfacer a TS
    const globalWhere = getTicketFilters({ id: user.id, rol: user.rol }, {
      page: 1,
      limit: 100,
      sort: [{ createdAt: 'desc' }]
    });

    // ── 2. PREPARACIÓN DE TIEMPOS ────────────────────────────────────────────
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

    // ── 3. EJECUCIÓN CONCURRENTE (PRISMA TRANSACTION / PROMISE ALL) ──────────
    const [
      total, 
      conteoPorEstado, 
      conteoGlobalEstados,
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
      // Métricas de Resumen (Basadas en whereSinEstado para consistencia visual)
      prisma.tarea.count({ where: whereSinEstado }),
      prisma.tarea.groupBy({ 
        by: ['estado'], 
        where: whereSinEstado, 
        _count: { estado: true } 
      }),

      // Existencia Global (Para lógica de mostrar/ocultar botones en UI)
      prisma.tarea.groupBy({
        by: ['estado'],
        where: globalWhere,
        _count: { estado: true }
      }),
      
      // Métricas Operativas Dinámicas (Basadas en baseWhere)
      prisma.tarea.groupBy({ by: ['tipo'], where: baseWhere, _count: { tipo: true } }),
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

      prisma.tarea.count({
        where: { ...baseWhere, estado: EstadoTarea.PENDIENTE, responsables: { none: {} } }
      }),

      prisma.tarea.groupBy({
        by: ['prioridad'],
        where: { 
          ...baseWhere, 
          estado: { in: closedStates },
          clasificacion: { not: ClasificacionTarea.RUTINA } 
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
          clasificacion: { not: ClasificacionTarea.RUTINA },
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

    // ── 4. PROCESAMIENTO DE VOLUMETRÍA Y DISTRIBUCIÓN ────────────────────────
    
    // Mapeo de conteos por estado (Filtrado por búsqueda)
    const resumenEstatus = conteoPorEstado.reduce((acc, curr) => ({ 
      ...acc, [curr.estado]: curr._count.estado 
    }), {} as Record<string, number>);

    // Mapeo de existencia global (Ignora búsqueda, para botones de UI)
    const resumenGlobalEstatus = conteoGlobalEstados.reduce((acc, curr) => ({ 
      ...acc, [curr.estado]: curr._count.estado 
    }), {} as Record<string, number>);

    const resumenTipo = conteoPorTipo.reduce((acc, curr) => ({ 
      ...acc, [curr.tipo]: curr._count.tipo 
    }), {} as Record<string, number>);

    // ── 5. PROCESAMIENTO DE EFICACIAS (TIEMPOS) ──────────────────────────────
    
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

    // ── 6. PROCESAMIENTO DE FOCOS ROJOS Y CUMPLIMIENTO ───────────────────────
    
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

    // ── 7. CARGA DE TRABAJO (TÉCNICOS) ───────────────────────────────────────
    
    const workload = tecnicosRaw.map(t => ({
      id: t.id,
      nombre: t.nombre,
      cantidadActivas: t.tareasAsignadas.length,
      minutosEstimadosPendientes: t.tareasAsignadas.reduce(
        (sum, tarea) => sum + (tarea.tiempoEstimado || 0), 0
      )
    }));

    // ── 8. RESPUESTA FINAL ESTRUCTURADA ──────────────────────────────────────
    
    return res.json({
      status: "success",
      data: {
        global: {
          total: total,
          backlogAtrasado: backlogVencidas,
          huerfanos: huerfanos,
          minutosTotalesPausa: pausaData._sum.duracion || 0
        },
        existenciaGlobal: resumenGlobalEstatus, // Útil para mostrar/ocultar botones UI
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