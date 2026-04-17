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

    // 1. TAREAS TERMINADAS (Para Rendimiento, Tiempos y Gráficas) - Filtrado estricto por finalizadoAt
    const tareasTerminadas = await prisma.tarea.findMany({
      where: {
        responsables: { some: { id: tecnicoId } },
        estado: { in: ESTADOS_TERMINADOS },
        ...(fechaInicio && fechaFin ? { finalizadoAt: { gte: fechaInicio, lte: fechaFin } } : {}),
      },
      select: {
        id: true, titulo: true, tipo: true, clasificacion: true, categoria: true, estado: true,
        createdAt: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
      },
      orderBy: { finalizadoAt: "desc" },
    });

    // 2. BACKLOG (Carga Actual) - Es atemporal, son sus tareas activas en este momento
    const backlog = await prisma.tarea.findMany({
      where: {
        responsables: { some: { id: tecnicoId } },
        estado: { in: ESTADOS_BACKLOG },
      },
      select: { estado: true, clasificacion: true, categoria: true }
    });

    // 3. PROMEDIO DEL EQUIPO (Para el cálculo de Bayes)
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
    const promedioEquipoCrudo = kpisEquipo.length > 0 ? kpisEquipo.reduce((a, b) => a + b, 0) / kpisEquipo.length : 0;
    const promedioEquipo = Number(promedioEquipoCrudo.toFixed(1));

    // 4. CÁLCULO DE SCORE AJUSTADO DEL TÉCNICO
    const kpisTecnico = tareasTerminadas.map(t => calcularKpiTarea(t));
    const kpiCrudo = kpisTecnico.length > 0 ? kpisTecnico.reduce((a, b) => a + b, 0) / kpisTecnico.length : 0;
    
    const scoreAjustadoCalc = (
      (kpiCrudo * kpisTecnico.length) + (promedioEquipoCrudo * CONSTANTE_CONFIANZA)
    ) / (kpisTecnico.length + CONSTANTE_CONFIANZA);
    const scoreAjustado = Number(scoreAjustadoCalc.toFixed(1));

    const conRechazo = tareasTerminadas.filter((t) => t.historial.length > 0).length;
    const aprobadas = tareasTerminadas.length - conRechazo;
    const tasaAceptacion = tareasTerminadas.length > 0 ? Number(((aprobadas / tareasTerminadas.length) * 100).toFixed(1)) : 0;

    // 5. TIEMPOS EXACTOS REGISTRADOS
    const idsTareasTerminadas = tareasTerminadas.map(t => t.id);
    const cargaRealUsuarioExacta = await prisma.intervaloTiempo.aggregate({
      where: {
        usuarioId: tecnicoId,
        fin: { not: null },
        tareaId: { in: idsTareasTerminadas.length > 0 ? idsTareasTerminadas : [-1] }
      },
      _sum: { duracion: true }
    });

    const totalRealMins = cargaRealUsuarioExacta._sum.duracion ?? 0;
    const conEstimado = tareasTerminadas.filter(t => t.tiempoEstimado && t.tiempoEstimado > 0);
    const totalEstimadoMins = conEstimado.reduce((acc, t) => acc + (t.tiempoEstimado || 0), 0);
    const porcentajeConsumo = totalEstimadoMins > 0 ? Math.round((totalRealMins / totalEstimadoMins) * 100) : null;

    // 6. CUMPLIMIENTO DE ENTREGAS
    let entregasA_Tiempo = 0;
    let entregasFuera_Tiempo = 0;
    let planeadoA_Tiempo = 0;
    let planeadoFuera_Tiempo = 0;

    tareasTerminadas.forEach(t => {
      if (t.fechaVencimiento && t.finalizadoAt) {
        if (t.finalizadoAt <= t.fechaVencimiento) entregasA_Tiempo++;
        else entregasFuera_Tiempo++;
      }
      if (t.tiempoEstimado && t.tiempoEstimado > 0) {
        const real = t.duracionReal || 0;
        if (real <= t.tiempoEstimado) planeadoA_Tiempo++;
        else planeadoFuera_Tiempo++;
      }
    });

    // 7. ALGORITMO HISTÓRICO GRÁFICA (Ahora aplica Score Ajustado a la gráfica también)
    const grafico: { label: string; score: number; noData: boolean }[] = [];
    
    if (fiStr && ffStr && fechaInicio && fechaFin) {
      // Días (Lunes a Domingo)
      const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const diasDif = Math.round((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24));
      
      for (let i = 0; i <= diasDif; i++) {
        const d = new Date(fechaInicio.getTime() + (i * 24 * 60 * 60 * 1000));
        const tareasDia = tareasTerminadas.filter(t => t.finalizadoAt && t.finalizadoAt.toDateString() === d.toDateString());
        
        if (tareasDia.length === 0) {
          grafico.push({ label: dias[d.getDay()] ?? '', score: 0, noData: true });
        } else {
          const kpis = tareasDia.map(x => calcularKpiTarea(x));
          const rawAvg = kpis.reduce((a,b) => a+b, 0) / kpis.length;
          const bucketAjustado = ((rawAvg * kpis.length) + (promedioEquipoCrudo * CONSTANTE_CONFIANZA)) / (kpis.length + CONSTANTE_CONFIANZA);
          grafico.push({ label: dias[d.getDay()] ?? '', score: Number(bucketAjustado.toFixed(1)), noData: false });
        }
      }
    } else if (Number(month) > 0) {
      // Si se filtra por un mes específico, no renderizamos gráfica.
    } else {
      // Meses del Año (Año Completo)
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      meses.forEach((nombreMes, i) => {
        const tareasMes = tareasTerminadas.filter(t => t.finalizadoAt && t.finalizadoAt.getMonth() === i);
        
        if (tareasMes.length === 0) {
          grafico.push({ label: nombreMes, score: 0, noData: true });
        } else {
          const kpis = tareasMes.map(x => calcularKpiTarea(x));
          const rawAvg = kpis.reduce((a,b) => a+b, 0) / kpis.length;
          const bucketAjustado = ((rawAvg * kpis.length) + (promedioEquipoCrudo * CONSTANTE_CONFIANZA)) / (kpis.length + CONSTANTE_CONFIANZA);
          grafico.push({ label: nombreMes, score: Number(bucketAjustado.toFixed(1)), noData: false });
        }
      });
    }

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
      .slice(0, 5);

    let scorePeriodoAnterior: number | null = null;
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
        const prevCrudo = kpisPrev.reduce((a, b) => a + b, 0) / kpisPrev.length;
        
        // Aplicamos la misma fórmula Bayesiana para el periodo anterior para que sea una comparación justa
        const prevAjustado = ((prevCrudo * kpisPrev.length) + (promedioEquipoCrudo * CONSTANTE_CONFIANZA)) / (kpisPrev.length + CONSTANTE_CONFIANZA);
        scorePeriodoAnterior = Number(prevAjustado.toFixed(1));
      }
    }

    return res.json({
      status: "success",
      data: {
        tecnico: { id: tecnico.id, nombre: tecnico.nombre, imagen: tecnico.imagen, cargo: tecnico.cargo, rol: tecnico.rol },
        rendimiento: {
          scoreAjustado,
          scoreColor: colorParaKpi(scoreAjustado),
          promedioEquipo,
          tasaAceptacion,
          totalTerminadas: tareasTerminadas.length,
          scorePeriodoAnterior 
        },
        tiempos: {
          totalEstimadoMins,
          totalRealMins,
          porcentajeConsumo,
          entregasA_Tiempo,
          entregasFuera_Tiempo,
          planeadoA_Tiempo,
          planeadoFuera_Tiempo
        },
        cargaActual: backlogData,
        grafico,
        topTareas,
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_TECNICO_DETALLE", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al obtener detalle del técnico." });
  }
};