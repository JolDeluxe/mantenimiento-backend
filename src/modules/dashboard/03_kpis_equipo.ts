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

    let targetDeptoId = (user.rol === Rol.SUPER_ADMIN && departamentoId) ? departamentoId : user.departamentoId;

    // 1. APLICAMOS LA MISMA REGLA DE NEGOCIO QUE EL GENERAL
    if (user.rol === Rol.SUPER_ADMIN && departamentoId) {
      baseWhere.departamentoId = departamentoId;
    }

    if (tecnicoId) baseWhere.responsables = { some: { id: tecnicoId } };
    if (fechaInicio && fechaFin) baseWhere.createdAt = { gte: fechaInicio, lte: fechaFin };

    // 2. Obtener TODOS los usuarios del equipo que deberían ser evaluados
    const todosLosUsuarios = await prisma.usuario.findMany({
        where: {
            rol: { in: ROLES_EVALUADOS },
            ...(targetDeptoId ? { departamentoId: targetDeptoId } : {})
        },
        select: { id: true, nombre: true, imagen: true, cargo: true, rol: true }
    });

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

    // Inicializar el mapa con todos los usuarios (tengan o no tareas)
    for (const u of todosLosUsuarios) {
        personalMap.set(u.id, {
            id: u.id, nombre: u.nombre, imagen: u.imagen, cargo: u.cargo, rol: u.rol,
            kpis: [], 
            minutosReales: cargaRealPorUsuario.get(u.id) ?? 0,
            minutosEstimados: 0
        });
    }

    let sumaTotalKpis = 0;
    let cantidadTotalTareas = 0;

    for (const tarea of tareas) {
      // FIX CRÍTICO: Si no está terminada, la saltamos. 
      // Así no arrastra el promedio a 0 injustamente ni altera el general.
      if (!ESTADOS_TERMINADOS.includes(tarea.estado)) continue;

      const kpiTarea = calcularKpiTarea(tarea as any);
      sumaTotalKpis += kpiTarea;
      cantidadTotalTareas++;

      for (const resp of tarea.responsables) {
        if (!personalMap.has(resp.id)) continue;
        
        const evalUser = personalMap.get(resp.id)!;
        evalUser.kpis.push(kpiTarea);
        evalUser.minutosEstimados += (tarea.tiempoEstimado ?? 0);
      }
    }

    // Usamos 2 decimales para que haga match exacto con la vista General
    const promedioEquipoGlobalCrudo = cantidadTotalTareas > 0 ? (sumaTotalKpis / cantidadTotalTareas) : 0;
    const promedioEquipoGlobal = Number(promedioEquipoGlobalCrudo.toFixed(2));

    const personalEvaluado = Array.from(personalMap.values()).map((t) => {
      const cantidadTareas = t.kpis.length;
      const kpiPromedioCrudo = cantidadTareas > 0 ? t.kpis.reduce((a, b) => a + b, 0) / cantidadTareas : 0; 
      const scoreReal = Number(kpiPromedioCrudo.toFixed(2)); // También subido a 2 decimales

      return {
        id: t.id,
        nombre: t.nombre,
        imagen: t.imagen,
        cargo: t.cargo,
        rol: t.rol,
        tareasCompletadas: cantidadTareas,
        kpiBase: scoreReal,
        scoreAjustado: scoreReal,
        color: cantidadTareas > 0 ? colorParaKpi(scoreReal) : 'neutral',
        minutosReales: t.minutosReales,
        minutosEstimados: t.minutosEstimados,
        calificaRanking: cantidadTareas >= 3 
      };
    }).sort((a, b) => {
      const aTiene = a.tareasCompletadas > 0;
      const bTiene = b.tareasCompletadas > 0;
      if (aTiene && !bTiene) return -1;
      if (!aTiene && bTiene) return 1;
      if (!aTiene && !bTiene) return a.nombre.localeCompare(b.nombre);

      if (a.calificaRanking && !b.calificaRanking) return -1;
      if (!a.calificaRanking && b.calificaRanking) return 1;

      if (b.scoreAjustado !== a.scoreAjustado) {
        return b.scoreAjustado - a.scoreAjustado;
      }
      
      return b.tareasCompletadas - a.tareasCompletadas;
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