import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { TecnicoDetalleParams, TecnicoDetalleQuery } from "./zod";
import { calcularKpiTarea, colorParaKpi, resolverRangoFechas, toMXDateStr  } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO, Rol.TECNICO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];

export const getTecnicoDetalle = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const { id: tecnicoId } = req.params as unknown as TecnicoDetalleParams;
    const { year, month, fechaInicio: fiStr, fechaFin: ffStr } = req.query as unknown as TecnicoDetalleQuery;

    // BARRERA IDOR: Si es técnico, solo puede consultar su propio ID
    if (user.rol === Rol.TECNICO && user.id !== Number(tecnicoId)) {
        return res.status(403).json({ error: "Solo puedes ver tus propias métricas." });
    }

    const tecnico = await prisma.usuario.findUnique({
      where: { id: Number(tecnicoId) },
      select: { id: true, nombre: true, imagen: true, cargo: true, rol: true, departamentoId: true },
    });

    if (!tecnico) return res.status(404).json({ error: "Técnico no encontrado." });

    // Regla existente: Jefes y Coordinadores solo ven a gente de su departamento
    if ((user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) && tecnico.departamentoId !== user.departamentoId) {
      return res.status(403).json({ error: "Sin acceso a este técnico." });
    }

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    const tareasPeriodo = await prisma.tarea.findMany({
      where: {
        responsables: { some: { id: tecnicoId } },
        estado: { not: EstadoTarea.CANCELADA },
        ...(fechaInicio && fechaFin ? { createdAt: { gte: fechaInicio, lte: fechaFin } } : {}),
      },
      select: {
        id: true, titulo: true, tipo: true, clasificacion: true, categoria: true, estado: true,
        createdAt: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
      },
      orderBy: { createdAt: "desc" },
    });

    const backlog = await prisma.tarea.findMany({
      where: {
        responsables: { some: { id: tecnicoId } },
        ...(fechaInicio && fechaFin ? { createdAt: { gte: fechaInicio, lte: fechaFin } } : {}),
      },
      select: { estado: true, clasificacion: true, categoria: true }
    });

    const todasLasTareasEquipo = await prisma.tarea.findMany({
      where: {
        estado: { not: EstadoTarea.CANCELADA },
        ...(fechaInicio && fechaFin ? { createdAt: { gte: fechaInicio, lte: fechaFin } } : {}),
      },
      select: { 
        estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 } 
      }
    });

    // 🚨 FIX CRÍTICO: Filtrar solo tareas terminadas antes del promedio de equipo
    const tareasEquipoTerminadas = todasLasTareasEquipo.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
    const kpisEquipo = tareasEquipoTerminadas.map(t => calcularKpiTarea(t as any));
    const promedioEquipoCrudo = kpisEquipo.length > 0 ? kpisEquipo.reduce((a, b) => a + b, 0) / kpisEquipo.length : 0;
    const promedioEquipo = Number(promedioEquipoCrudo.toFixed(2));

    // 🚨 FIX CRÍTICO: Filtrar solo tareas terminadas antes del promedio del técnico
    const tareasTerminadas = tareasPeriodo.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
    const kpisTecnico = tareasTerminadas.map(t => calcularKpiTarea(t as any));
    const kpiCrudo = kpisTecnico.length > 0 ? kpisTecnico.reduce((a, b) => a + b, 0) / kpisTecnico.length : 0;
    const scoreAjustado = Number(kpiCrudo.toFixed(2)); 

    const conRechazo = tareasTerminadas.filter((t) => t.historial.length > 0).length;
    const aprobadas = tareasTerminadas.length - conRechazo;
    const tasaAceptacion = tareasTerminadas.length > 0 ? Number(((aprobadas / tareasTerminadas.length) * 100).toFixed(1)) : 0;

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

    let entregasA_Tiempo = 0;
    let entregasFuera_Tiempo = 0;
    let planeadoA_Tiempo = 0;
    let planeadoFuera_Tiempo = 0;

    tareasTerminadas.forEach(t => {
      if (t.fechaVencimiento && t.finalizadoAt) {
        const dFin  = toMXDateStr(new Date(t.finalizadoAt));
        const dVenc = toMXDateStr(new Date(t.fechaVencimiento));
        if (dFin <= dVenc) entregasA_Tiempo++;
        else entregasFuera_Tiempo++;
      }
      if (t.tiempoEstimado && t.tiempoEstimado > 0) {
        const real = t.duracionReal || 0;
        if (real <= t.tiempoEstimado) planeadoA_Tiempo++;
        else planeadoFuera_Tiempo++;
      }
    });

    const grafico: { label: string; score: number; noData: boolean }[] = [];
    
    if (fiStr && ffStr && fechaInicio && fechaFin) {
      const dias = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const diasDif = Math.round((fechaFin.getTime() - fechaInicio.getTime()) / (1000 * 60 * 60 * 24));
      
      for (let i = 0; i <= diasDif; i++) {
        const startDia = new Date(fechaInicio.getTime() + (i * 24 * 60 * 60 * 1000));
        const endDia = new Date(startDia.getTime() + (24 * 60 * 60 * 1000) - 1);
        
        const tareasDiaJoel = tareasPeriodo.filter(t => t.createdAt && t.createdAt.getTime() >= startDia.getTime() && t.createdAt.getTime() <= endDia.getTime());
        // 🚨 FIX GRÁFICA DIARIA: Filtrar terminadas
        const terminadasDiaJoel = tareasDiaJoel.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
        
        if (terminadasDiaJoel.length === 0) {
          grafico.push({ label: dias[startDia.getDay()] ?? '', score: 0, noData: true });
        } else {
          const kpisJoelDia = terminadasDiaJoel.map(x => calcularKpiTarea(x as any));
          const avgJoelDia = kpisJoelDia.reduce((a,b) => a+b, 0) / kpisJoelDia.length;
          
          grafico.push({ label: dias[startDia.getDay()] ?? '', score: Number(avgJoelDia.toFixed(2)), noData: false });
        }
      }
    } else if (Number(month) > 0) {
      // (Lógica para mes específico, actualmente sin implementar según archivo original)
    } else {
      const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
      const targetYear = year ? Number(year) : new Date().getFullYear();

      meses.forEach((nombreMes, i) => {
        const bounds = resolverRangoFechas(targetYear, i + 1, undefined, undefined);
        if (!bounds.fechaInicio || !bounds.fechaFin) {
          grafico.push({ label: nombreMes, score: 0, noData: true });
          return;
        }

        const startMes = bounds.fechaInicio.getTime();
        const endMes = bounds.fechaFin.getTime();

        const tareasMesJoel = tareasPeriodo.filter(t => t.createdAt && t.createdAt.getTime() >= startMes && t.createdAt.getTime() <= endMes);
        // 🚨 FIX GRÁFICA MENSUAL: Filtrar terminadas
        const terminadasMesJoel = tareasMesJoel.filter(t => ESTADOS_TERMINADOS.includes(t.estado));
        
        if (terminadasMesJoel.length === 0) {
          grafico.push({ label: nombreMes, score: 0, noData: true });
        } else {
          const kpisJoelMes = terminadasMesJoel.map(x => calcularKpiTarea(x as any));
          const avgJoelMes = kpisJoelMes.reduce((a,b) => a+b, 0) / kpisJoelMes.length;
          
          grafico.push({ label: nombreMes, score: Number(avgJoelMes.toFixed(2)), noData: false });
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
          estado: { not: EstadoTarea.CANCELADA },
          createdAt: { gte: prevInicio, lte: prevFin }
        },
        select: { 
          estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
          historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 }
        }
      });

      // 🚨 FIX PERÍODO ANTERIOR: Filtrar terminadas
      const terminadasAnteriores = tareasAnteriores.filter(t => ESTADOS_TERMINADOS.includes(t.estado));

      if (terminadasAnteriores.length > 0) {
        const kpisPrev = terminadasAnteriores.map(t => calcularKpiTarea(t as any));
        const prevCrudo = kpisPrev.reduce((a, b) => a + b, 0) / kpisPrev.length;
        scorePeriodoAnterior = Number(prevCrudo.toFixed(2));
      }
    }

    const ESTADOS_ACTIVOS: EstadoTarea[] = [EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];
    
    const tareasPendientesDetalle = await prisma.tarea.findMany({
      where: {
        responsables: { some: { id: Number(tecnicoId) } },
        estado: { in: ESTADOS_ACTIVOS }
      },
      select: {
        id: true,
        titulo: true,
        prioridad: true,
        fechaVencimiento: true,
        // Traemos si tiene un rechazo en su historial para etiquetarla
        historial: {
          where: { estadoNuevo: EstadoTarea.RECHAZADO },
          select: { id: true },
          take: 1
        }
      },
      orderBy: { fechaVencimiento: 'asc' }, // Las más urgentes/atrasadas primero
      take: 10
    });

    return res.json({
      status: "success",
      data: {
        tecnico: { id: tecnico.id, nombre: tecnico.nombre, imagen: tecnico.imagen, cargo: tecnico.cargo, rol: tecnico.rol },
        rendimiento: {
          scoreAjustado,
          scoreColor: colorParaKpi(scoreAjustado),
          promedioEquipo,
          tasaAceptacion,
          aprobadas, 
          rechazadas: conRechazo,
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
        tareasPendientes: tareasPendientesDetalle,
        grafico,
        topTareas,
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_TECNICO_DETALLE", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error al obtener detalle del técnico." });
  }
};