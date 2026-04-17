import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import { calcularKpiTarea, colorParaKpi, resolverRangoFechas } from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ROLES_EVALUADOS: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];

export const getKpisEquipo = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) return res.status(403).json({ error: "Acceso denegado." });

    const { year, month, fechaInicio: fiStr, fechaFin: ffStr, departamentoId, tecnicoId } =
      req.query as unknown as DashboardFiltrosQuery;

    const { fechaInicio, fechaFin } = resolverRangoFechas(year, month, fiStr, ffStr);

    const baseWhere: Prisma.TareaWhereInput = { 
      estado: { not: EstadoTarea.CANCELADA } 
    };

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) return res.status(400).json({ error: "Usuario sin departamento." });
      baseWhere.departamentoId = user.departamentoId;
    }

    if (departamentoId && user.rol === Rol.SUPER_ADMIN) baseWhere.departamentoId = departamentoId;
    if (tecnicoId) baseWhere.responsables = { some: { id: tecnicoId } };
    if (fechaInicio && fechaFin) baseWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    const tareas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        estado: true, finalizadoAt: true, fechaVencimiento: true, duracionReal: true, tiempoEstimado: true,
        historial: { where: { estadoNuevo: EstadoTarea.RECHAZADO }, select: { id: true }, take: 1 },
        responsables: { select: { id: true, nombre: true, imagen: true, cargo: true, rol: true } },
      },
    });

    const cargaRealRaw = await prisma.intervaloTiempo.groupBy({
      by: ["usuarioId"],
      where: {
        fin: { not: null },
        tarea: baseWhere,
      },
      _sum: { duracion: true },
    });
    
    const cargaRealPorUsuario = new Map<number, number>(cargaRealRaw.map((r) => [r.usuarioId!, r._sum.duracion ?? 0]));

    type EvaluadoEntry = { 
      id: number; nombre: string; imagen: string | null; cargo: string | null; rol: Rol; 
      kpis: number[]; minutosReales: number; minutosEstimados: number; 
    };
    const personalMap = new Map<number, EvaluadoEntry>();
    let sumaTotalKpis = 0;
    let cantidadTotalTareas = 0;

    for (const tarea of tareas) {
      const kpiTarea = ESTADOS_TERMINADOS.includes(tarea.estado) ? calcularKpiTarea(tarea as any) : 0;
      sumaTotalKpis += kpiTarea;
      cantidadTotalTareas++;

      for (const resp of tarea.responsables) {
        if (!ROLES_EVALUADOS.includes(resp.rol)) continue;

        if (!personalMap.has(resp.id)) {
          personalMap.set(resp.id, {
            id: resp.id, nombre: resp.nombre, imagen: resp.imagen, cargo: resp.cargo, rol: resp.rol,
            kpis: [], 
            minutosReales: cargaRealPorUsuario.get(resp.id) ?? 0,
            minutosEstimados: 0
          });
        }
        
        const evalUser = personalMap.get(resp.id)!;
        evalUser.kpis.push(kpiTarea);
        evalUser.minutosEstimados += (tarea.tiempoEstimado ?? 0);
      }
    }

    const promedioEquipoGlobalCrudo = cantidadTotalTareas > 0 ? (sumaTotalKpis / cantidadTotalTareas) : 0;
    const promedioEquipoGlobal = Number(promedioEquipoGlobalCrudo.toFixed(1));

    const personalEvaluado = Array.from(personalMap.values()).map((t) => {
      const cantidadTareas = t.kpis.length;
      const kpiPromedioCrudo = cantidadTareas > 0 ? t.kpis.reduce((a, b) => a + b, 0) / cantidadTareas : 0;
      
      const scoreReal = Number(kpiPromedioCrudo.toFixed(1));

      return {
        id: t.id, nombre: t.nombre, imagen: t.imagen, cargo: t.cargo, rol: t.rol,
        tareasCompletadas: cantidadTareas, 
        kpiBase: scoreReal, 
        scoreAjustado: scoreReal, 
        color: colorParaKpi(scoreReal),
        minutosReales: t.minutosReales,
        minutosEstimados: t.minutosEstimados
      };
    }).sort((a, b) => {
      const aCalificaRanking = a.tareasCompletadas >= 5;
      const bCalificaRanking = b.tareasCompletadas >= 5;

      if (aCalificaRanking && !bCalificaRanking) return -1;
      if (!aCalificaRanking && bCalificaRanking) return 1;

      if (b.scoreAjustado === a.scoreAjustado) {
        return b.tareasCompletadas - a.tareasCompletadas;
      }
      return b.scoreAjustado - a.scoreAjustado;
    });

    const tecnicos = personalEvaluado.filter(p => p.rol === Rol.TECNICO);
    const coordinadores = personalEvaluado.filter(p => p.rol === Rol.COORDINADOR_MTTO);

    return res.json({ 
      status: "success", 
      data: { 
        promedioEquipoGlobal,
        tecnicos, 
        coordinadores 
      } 
    });
  } catch (error) {
    await registrarError("DASHBOARD_KPIS_EQUIPO", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs de Equipo." });
  }
};