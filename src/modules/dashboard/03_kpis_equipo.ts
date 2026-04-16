import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import { calcularKpiTarea, colorParaKpi, resolverRangoFechas } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
const CONSTANTE_CONFIANZA = 5; // C para el algoritmo de Bayes

export const getKpisEquipo = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } =
      req.query as unknown as DashboardFiltrosQuery;

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    const baseWhere: Prisma.TareaWhereInput = { estado: { in: ESTADOS_TERMINADOS } };

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) return res.status(400).json({ error: "Usuario sin departamento." });
      baseWhere.departamentoId = user.departamentoId;
    }

    if (departamentoId && user.rol === Rol.SUPER_ADMIN) baseWhere.departamentoId = departamentoId;
    if (tecnicoId) baseWhere.responsables = { some: { id: tecnicoId } };
    if (fechaInicio && fechaFin) baseWhere.finalizadoAt = { gte: fechaInicio, lte: fechaFin };

    const tareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
        responsables: { select: { id: true, nombre: true, imagen: true, cargo: true, rol: true } },
      },
    });

    // 1. Obtener carga real (minutos trabajados)
    const cargaRealRaw = await prisma.intervaloTiempo.groupBy({
      by: ["usuarioId"],
      where: {
        fin: { not: null },
        ...(fechaInicio && fechaFin ? { inicio: { gte: fechaInicio, lte: fechaFin } } : {}),
        tarea: baseWhere,
      },
      _sum: { duracion: true },
    });
    const cargaRealPorTecnico = new Map<number, number>(cargaRealRaw.map((r) => [r.usuarioId!, r._sum.duracion ?? 0]));

    // 2. Agrupar KPIs y calcular el "Promedio del Equipo"
    type TecnicoEntry = { id: number; nombre: string; imagen: string | null; cargo: string | null; rol: Rol; kpis: number[]; minutosReales: number; };
    const tecnicosMap = new Map<number, TecnicoEntry>();
    let sumaTotalKpis = 0;
    let cantidadTotalTareas = 0;

    for (const tarea of tareas) {
      const kpiTarea = calcularKpiTarea(tarea);
      sumaTotalKpis += kpiTarea;
      cantidadTotalTareas++;

      for (const resp of tarea.responsables) {
        if (!tecnicosMap.has(resp.id)) {
          tecnicosMap.set(resp.id, {
            id: resp.id, nombre: resp.nombre, imagen: resp.imagen, cargo: resp.cargo, rol: resp.rol,
            kpis: [], minutosReales: cargaRealPorTecnico.get(resp.id) ?? 0,
          });
        }
        tecnicosMap.get(resp.id)!.kpis.push(kpiTarea);
      }
    }

    const promedioEquipoGlobal = cantidadTotalTareas > 0 ? (sumaTotalKpis / cantidadTotalTareas) : 0;

    // 3. Aplicar Algoritmo de Bayes y formatear
    const personalEvaluado = Array.from(tecnicosMap.values()).map((t) => {
      const cantidadTareas = t.kpis.length;
      const kpiPromedioCrudo = cantidadTareas > 0 ? t.kpis.reduce((a, b) => a + b, 0) / cantidadTareas : 0;
      
      // Algoritmo Infalible: Score Ajustado por volumen de tareas
      const scoreAjustado = Math.round(
        ((kpiPromedioCrudo * cantidadTareas) + (promedioEquipoGlobal * CONSTANTE_CONFIANZA)) / 
        (cantidadTareas + CONSTANTE_CONFIANZA)
      );

      return {
        id: t.id, nombre: t.nombre, imagen: t.imagen, cargo: t.cargo, rol: t.rol,
        tareasCompletadas: cantidadTareas, 
        kpiBase: Math.round(kpiPromedioCrudo), 
        scoreAjustado, // Este es el que define quién es el mejor
        color: colorParaKpi(scoreAjustado),
        minutosReales: t.minutosReales,
      };
    }).sort((a, b) => b.scoreAjustado - a.scoreAjustado);

    // 4. Separar por Roles para frontend
    const tecnicos = personalEvaluado.filter(p => p.rol === Rol.TECNICO);
    const coordinadores = personalEvaluado.filter(p => p.rol === Rol.COORDINADOR_MTTO);

    return res.json({ 
      status: "success", 
      data: { 
        promedioEquipoGlobal: Math.round(promedioEquipoGlobal),
        tecnicos, 
        coordinadores 
      } 
    });
  } catch (error) {
    await registrarError("DASHBOARD_KPIS_EQUIPO", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs de Equipo." });
  }
};