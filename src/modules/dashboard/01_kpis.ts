import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { DashboardFiltrosQuery } from "./zod";
import {
  calcularKpiTarea,
  calcularKpiAgregado,
  colorParaKpi,
  buildDateRange,
} from "./helper_metrics";

const ROLES_CON_ACCESO: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];

export const getDashboardKpis = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (!ROLES_CON_ACCESO.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const { year, month, departamentoId, tecnicoId } =
      req.query as unknown as DashboardFiltrosQuery;

    const { fechaInicio, fechaFin } = buildDateRange(year, month);

    const baseWhere: Prisma.TareaWhereInput = {
      estado: { in: ESTADOS_TERMINADOS },
    };

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) {
        return res.status(400).json({ error: "Usuario sin departamento asignado." });
      }
      baseWhere.departamentoId = user.departamentoId;
    }

    if (departamentoId && user.rol === Rol.SUPER_ADMIN) {
      baseWhere.departamentoId = departamentoId;
    }

    if (tecnicoId) {
      baseWhere.responsables = { some: { id: tecnicoId } };
    }

    if (fechaInicio && fechaFin) {
      baseWhere.finalizadoAt = { gte: fechaInicio, lte: fechaFin };
    }

    // EXTRAEMOS TITULO, DESCRIPCION Y TIPO PARA EL ÁREA
    const tareasTerminadas = await prisma.tarea.findMany({
      where: baseWhere,
      select: {
        id: true,
        titulo: true,
        descripcion: true,
        tipo: true,
        estado: true,
        finalizadoAt: true,
        fechaVencimiento: true,
        duracionReal: true,
        tiempoEstimado: true,
        planta: true,
        area: true,
        clasificacion: true,
        departamentoId: true,
        responsables: { select: { id: true, nombre: true, imagen: true, cargo: true } },
        historial: {
          where: { estadoNuevo: EstadoTarea.RECHAZADO },
          select: { id: true },
          take: 1,
        },
      },
    });

    const cargaRealRaw = await prisma.intervaloTiempo.groupBy({
      by: ["usuarioId"],
      where: {
        fin: { not: null },
        ...(fechaInicio && fechaFin ? { inicio: { gte: fechaInicio, lte: fechaFin } } : {}),
        tarea: baseWhere,
      },
      _sum: { duracion: true },
      _count: { id: true },
    });

    const cargaRealPorTecnico = new Map<number, number>(
      cargaRealRaw.map((r) => [r.usuarioId!, r._sum.duracion ?? 0])
    );

    // -- SECCIÓN 1: GENERAL (Resumen) --
    const kpisIndividuales = tareasTerminadas.map((t) => calcularKpiTarea(t));
    const { kpiPromedio: kpiGlobal, datosSuficientes: kpiDatosSuficientes } =
      calcularKpiAgregado(kpisIndividuales);

    const totalTerminadas = tareasTerminadas.length;
    const sinRechazos = tareasTerminadas.filter((t) => t.historial.length === 0).length;
    const firstTimeFixRate =
      totalTerminadas > 0 ? Math.round((sinRechazos / totalTerminadas) * 100) : 0;

    const conFecha = tareasTerminadas.filter((t) => t.finalizadoAt && t.fechaVencimiento);
    const aTiempo = conFecha.filter((t) => t.finalizadoAt! <= t.fechaVencimiento!).length;
    const slaRate = conFecha.length > 0 ? Math.round((aTiempo / conFecha.length) * 100) : null;

    // -- SECCIÓN 2: EQUIPO --
    const tecnicosMap = new Map<number, {
      id: number;
      nombre: string;
      imagen: string | null;
      cargo: string | null;
      kpis: number[];
      minutosReales: number;
    }>();

    for (const tarea of tareasTerminadas) {
      const kpiTarea = calcularKpiTarea(tarea);
      for (const resp of tarea.responsables) {
        if (!tecnicosMap.has(resp.id)) {
          tecnicosMap.set(resp.id, {
            id: resp.id,
            nombre: resp.nombre,
            imagen: resp.imagen,
            cargo: resp.cargo,
            kpis: [],
            minutosReales: cargaRealPorTecnico.get(resp.id) ?? 0,
          });
        }
        tecnicosMap.get(resp.id)!.kpis.push(kpiTarea);
      }
    }

    const kpiPorTecnico = Array.from(tecnicosMap.values()).map((t) => {
      const { kpiPromedio, datosSuficientes } = calcularKpiAgregado(t.kpis);
      return {
        id: t.id,
        nombre: t.nombre,
        imagen: t.imagen,
        cargo: t.cargo,
        tareasCompletadas: t.kpis.length,
        kpiPromedio,
        color: colorParaKpi(kpiPromedio),
        datosSuficientes,
        minutosReales: t.minutosReales,
      };
    }).sort((a, b) => b.kpiPromedio - a.kpiPromedio);

    // -- SECCIÓN 3: ÁREA (Mapa Calor + Tickets Evaluados) --
    const areaMap = new Map<string, { planta: string; area: string; total: number; rechazadas: number }>();

    for (const t of tareasTerminadas) {
      const key = `${t.planta}__${t.area}`;
      if (!areaMap.has(key)) {
        areaMap.set(key, { planta: t.planta, area: t.area ?? "General", total: 0, rechazadas: 0 });
      }
      const entry = areaMap.get(key)!;
      entry.total++;
      if (t.historial.length > 0) entry.rechazadas++;
    }

    const mapaCalor = Array.from(areaMap.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    // Tickets detallados para la pestaña de Área (solo los que son de tipo TICKET)
    const ticketsEvaluados = tareasTerminadas
      .filter((t) => t.tipo === "TICKET")
      .map((t) => ({
        id: t.id,
        titulo: t.titulo,
        descripcion: t.descripcion,
        planta: t.planta,
        area: t.area,
        clasificacion: t.clasificacion,
        estado: t.estado,
        fechaFinalizado: t.finalizadoAt,
        kpi: calcularKpiTarea(t),
        colorKpi: colorParaKpi(calcularKpiTarea(t))
      }))
      .sort((a, b) => (b.fechaFinalizado?.getTime() || 0) - (a.fechaFinalizado?.getTime() || 0))
      .slice(0, 50); // Límite de seguridad para UI

    const clasificacionMap = new Map<string, number>();
    for (const t of tareasTerminadas) {
      const c = t.clasificacion ?? "SIN_CLASIFICACION";
      clasificacionMap.set(c, (clasificacionMap.get(c) ?? 0) + 1);
    }
    const distribucionClasificacion = Object.fromEntries(clasificacionMap);

    const aniosConDatos = await prisma.tarea.groupBy({
      by: ["createdAt"],
      where: {
        estado: { in: ESTADOS_TERMINADOS },
        ...(user.rol !== Rol.SUPER_ADMIN ? { departamentoId: user.departamentoId! } : {}),
      },
      _count: { id: true },
    });

    const yearsSet = new Set<number>(aniosConDatos.map((r) => r.createdAt.getFullYear()));
    const aniosDisponibles = Array.from(yearsSet).sort((a, b) => b - a);

    return res.json({
      status: "success",
      data: {
        resumen: {
          totalTerminadas,
          kpiGlobal,
          kpiColor: colorParaKpi(kpiGlobal),
          kpiDatosSuficientes,
          firstTimeFixRate,
          firstTimeFixColor: colorParaKpi(firstTimeFixRate),
          slaRate,
          slaColor: slaRate !== null ? colorParaKpi(slaRate) : null,
        },
        kpiPorTecnico,
        mapaCalor,
        ticketsEvaluados,
        distribucionClasificacion,
        aniosDisponibles,
      },
    });
  } catch (error) {
    await registrarError("DASHBOARD_KPIS", req.user?.id ?? null, error);
    return res.status(500).json({ error: "Error interno al calcular KPIs." });
  }
};