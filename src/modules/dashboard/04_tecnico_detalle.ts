import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { TecnicoDetalleParams, TecnicoDetalleQuery } from "./zod";
import { calcularKpiTarea, colorParaKpi, resolverRangoFechas } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
const ESTADOS_BACKLOG: EstadoTarea[] = [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];
const CONSTANTE_CONFIANZA = 5;

export const getTecnicoDetalle = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const { id: tecnicoId } = req.params as unknown as TecnicoDetalleParams;
    const { year, month, fechaInicio: fiStr, fechaFin: ffStr } = req.query as unknown as TecnicoDetalleQuery;

    const tecnico = await prisma.usuario.findUnique({
      where: { id: tecnicoId },
      select: { id: true, nombre: true, imagen: true, cargo: true, rol: true, departamentoId: true },
    });

    if (!tecnico) return res.status(404).json({ error: "Técnico no encontrado." });

    if ((user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) && tecnico.departamentoId !== user.departamentoId) {
      return res.status(403).json({ error: "Sin acceso a este técnico." });
    }

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    // 1. OBTENER TODAS LAS TAREAS DEL TÉCNICO (Terminadas y Backlog)
    const baseWhere = {
      responsables: { some: { id: tecnicoId } },
      ...(fechaInicio && fechaFin ? { createdAt: { gte: fechaInicio, lte: fechaFin } } : {}),
    };

    const todasLasTareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        id: true, titulo: true, tipo: true, clasificacion: true, categoria: true, estado: true,
        finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    const tareasTerminadas = todasLasTareas.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
    const backlog = todasLasTareas.filter(t => ESTADOS_BACKLOG.includes(t.estado));

    // 2. PROMEDIO DEL EQUIPO (Para comparar)
    const todasLasTerminadasEquipo = await prisma.tarea.findMany({
      where: {
        estado: { in: ESTADOS_TERMINADOS },
        ...(tecnico.departamentoId ? { departamentoId: tecnico.departamentoId } : {}),
        ...(fechaInicio && fechaFin ? { finalizadoAt: { gte: fechaInicio, lte: fechaFin } } : {}),
      },
      select: { 
        estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 } 
      }
    });

    const kpisEquipo = todasLasTerminadasEquipo.map(t => calcularKpiTarea(t));
    const promedioEquipo = kpisEquipo.length > 0 ? kpisEquipo.reduce((a, b) => a + b, 0) / kpisEquipo.length : 0;

    // 3. SCORE AJUSTADO DEL TÉCNICO
    const kpisTecnico = tareasTerminadas.map(t => calcularKpiTarea(t));
    const kpiCrudo = kpisTecnico.length > 0 ? kpisTecnico.reduce((a, b) => a + b, 0) / kpisTecnico.length : 0;
    
    const scoreAjustado = Math.round(
      ((kpiCrudo * kpisTecnico.length) + (promedioEquipo * CONSTANTE_CONFIANZA)) / 
      (kpisTecnico.length + CONSTANTE_CONFIANZA)
    );

    // 4. TASAS Y TIEMPOS (CUMPLIMIENTO)
    const conRechazo = tareasTerminadas.filter((t) => t.historial.length > 0).length;
    const aprobadas = tareasTerminadas.length - conRechazo;
    const tasaAceptacion = tareasTerminadas.length > 0 ? Math.round((aprobadas / tareasTerminadas.length) * 100) : 0;

    const conEstimado = tareasTerminadas.filter(t => t.tiempoEstimado && t.tiempoEstimado > 0);
    const totalEstimado = conEstimado.reduce((acc, t) => acc + (t.tiempoEstimado || 0), 0);
    const totalReal = conEstimado.reduce((acc, t) => acc + (t.duracionReal || 0), 0);
    
    // Porcentaje de horas: Si hizo 120 mins de 100 planeados = 120%. Si hizo 80 mins = 80% (Mejor).
    const porcentajeHorasRealVsEstimado = totalEstimado > 0 ? Math.round((totalReal / totalEstimado) * 100) : null;

    // 5. BACKLOG (CARGA DE TRABAJO ACTUAL)
    const backlogData = {
      total: backlog.length,
      estados: Object.values(EstadoTarea).reduce((acc, e) => ({ ...acc, [e]: 0 }), {} as Record<EstadoTarea, number>),
      clasificaciones: {} as Record<string, number>,
      categorias: {} as Record<string, number>
    };

    backlog.forEach(t => {
      backlogData.estados[t.estado]++;
      backlogData.clasificaciones[t.clasificacion] = (backlogData.clasificaciones[t.clasificacion] || 0) + 1;
      const cat = t.categoria || "SIN_CATEGORIA";
      backlogData.categorias[cat] = (backlogData.categorias[cat] || 0) + 1;
    });

    // 6. TOP TAREAS (Frecuencia en terminadas)
    const topTareasMap = new Map<string, number>();
    tareasTerminadas.forEach(t => {
      const key = `${t.clasificacion}|${t.categoria || "SIN_CATEGORIA"}`;
      topTareasMap.set(key, (topTareasMap.get(key) || 0) + 1);
    });

    const topTareas = Array.from(topTareasMap.entries())
      .map(([key, cantidad]) => {
        const [clasificacion, categoria] = key.split("|");
        return { clasificacion, categoria, cantidad };
      })
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5); // Top 5

    // 7. EVOLUCIÓN (Calculamos el score crudo del periodo anterior)
    let scorePeriodoAnterior = null;
    if (fechaInicio && fechaFin) {
      const spanMs = fechaFin.getTime() - fechaInicio.getTime();
      const prevFin = new Date(fechaInicio.getTime() - 1);
      const prevInicio = new Date(prevFin.getTime() - spanMs);

      const tareasAnteriores = await prisma.tarea.findMany({
        where: {
          responsables: { some: { id: tecnicoId } },
          estado: { in: ESTADOS_TERMINADOS },
          finalizadoAt: { gte: prevInicio, lte: prevFin }
        },
        select: { 
          estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
          historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 }
        }
      });

      if (tareasAnteriores.length > 0) {
        const kpisPrev = tareasAnteriores.map(t => calcularKpiTarea(t));
        scorePeriodoAnterior = Math.round(kpisPrev.reduce((a, b) => a + b, 0) / kpisPrev.length);
      }
    }

    return res.json({
      status: "success",
      data: {
        tecnico: { id: tecnico.id, nombre: tecnico.nombre, imagen: tecnico.imagen, cargo: tecnico.cargo, rol: tecnico.rol },
        rendimiento: {
          scoreAjustado,
          scoreColor: colorParaKpi(scoreAjustado),
          promedioEquipo: Math.round(promedioEquipo),
          tasaAceptacion, // % de trabajos bien a la primera
          totalTerminadas: tareasTerminadas.length,
          scorePeriodoAnterior // Para flechita verde (subió) o roja (bajó) en el UI
        },
        tiempos: {
          totalEstimadoMins: totalEstimado,
          totalRealMins: totalReal,
          porcentajeConsumo: porcentajeHorasRealVsEstimado // Si > 100%, es lento. Si < 100%, es rápido.
        },
        cargaActual: backlogData,
        topTareas,
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_TECNICO_DETALLE", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al obtener detalle del técnico." });
  }
};