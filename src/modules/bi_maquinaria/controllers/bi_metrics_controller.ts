import type { Request, Response } from "express";
import { registrarError } from "../../../utils/logger";
import { metricsQuerySchema, machineDetailQuerySchema } from "../zod/metrics_query_schema";
import { BIQueryService } from "../services/bi_query_service";
import { BIMetricsService } from "../services/bi_metrics_service";
import { BIAggregationService } from "../services/bi_aggregation_service";
import { BIDetailService } from "../services/bi_detail_service";
import { BIFilterService } from "../services/bi_filter_service";
import { validarYCalcularPeriodo } from "../calculations/periodos";
import { agregarMetricasGrupo } from "../calculations/aggregation";

export const getBIKPISController = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Autenticación requerida.",
      },
    });
  }
  const ahora = new Date();

  // 1. Validar parámetros de la query
  const validation = metricsQuerySchema.safeParse({ query: req.query });
  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_INVALID_PARAMS",
        message: "Los parámetros de consulta son inválidos.",
        details: validation.error.issues,
      },
    });
  }

  const queryParams = validation.data.query;

  try {
    // 2. Calcular periodo efectivo
    const { desde, hasta, hastaEfectivo, periodoRecortadoAHoy } = validarYCalcularPeriodo({
      desdeStr: queryParams.desde,
      hastaStr: queryParams.hasta,
      ahora,
    });

    // 3. Obtener población de máquinas filtradas
    const {
      maquinas,
      totalMaquinasFiltradas,
      maquinasSinAreaExcluidas,
    } = await BIQueryService.obtenerMaquinas({
      agrupacion: queryParams.agrupacion,
      maquinaId: queryParams.maquinaId,
      proceso: queryParams.proceso,
      area: queryParams.area,
      criticidad: queryParams.criticidad,
      estadoMaquina: queryParams.estadoMaquina,
      buscar: queryParams.buscar,
      incluirAreaNula: queryParams.incluirAreaNula,
      hastaEfectivo,
    });

    // 4. Calcular métricas individuales para la población de máquinas
    const individualResults = await BIMetricsService.calcularMetricasMaquinas(
      maquinas,
      desde,
      hastaEfectivo,
      queryParams.calidad,
      ahora,
      queryParams.incluirHistoricos,
      hasta
    );

    // 5. Agrupar y agregar
    const aggregatedData = BIAggregationService.agruparYAgregar(
      individualResults,
      queryParams.agrupacion,
      queryParams.ordenarPor,
      queryParams.direccion
    );
    const totalRegistros = aggregatedData.length;
    const totalPaginas = Math.ceil(totalRegistros / queryParams.limite);
    const dataPaginada = aggregatedData.slice(
      (queryParams.pagina - 1) * queryParams.limite,
      queryParams.pagina * queryParams.limite
    );
    const paginacion = {
      pagina: queryParams.pagina,
      limite: queryParams.limite,
      totalRegistros,
      totalPaginas,
    };

    // 6. Calcular Resumen Global
    const metricasGlobales = agregarMetricasGrupo(individualResults);
    const hayFiltroParticipacion = Boolean(
      queryParams.maquinaId ||
      queryParams.proceso ||
      queryParams.area ||
      queryParams.criticidad ||
      queryParams.estadoMaquina ||
      queryParams.buscar
    );
    let solicitudesTotalBase = metricasGlobales.frecuencia.valor;
    if (hayFiltroParticipacion) {
      const { maquinas: maquinasBaseParticipacion } = await BIQueryService.obtenerMaquinas({
        agrupacion: queryParams.agrupacion,
        incluirAreaNula: queryParams.incluirAreaNula,
        hastaEfectivo,
      });
      const metricasBaseParticipacion = await BIMetricsService.calcularMetricasMaquinas(
        maquinasBaseParticipacion,
        desde,
        hastaEfectivo,
        queryParams.calidad,
        ahora,
        queryParams.incluirHistoricos,
        hasta
      );
      solicitudesTotalBase = agregarMetricasGrupo(metricasBaseParticipacion).frecuencia.valor;
    }
    const participacionSolicitudesPorcentaje = solicitudesTotalBase > 0
      ? (metricasGlobales.frecuencia.valor / solicitudesTotalBase) * 100
      : 0;
    const topRows = aggregatedData.slice(0, Math.min(10, aggregatedData.length));
    const topMinutosProgramados = topRows.reduce(
      (total, row) => total + row.metricas.disponibilidad.minutosProgramados,
      0
    );
    const topMinutosParoEquivalentes = topRows.reduce(
      (total, row) => total + row.metricas.disponibilidad.minutosParoEquivalentes,
      0
    );
    const topDisponibilidadPorcentaje = topMinutosProgramados > 0
      ? Math.max(0, Math.min(100, ((topMinutosProgramados - topMinutosParoEquivalentes) / topMinutosProgramados) * 100))
      : null;
    let maquinasObservadas = maquinas.length;
    let maquinasConFallas = 0;
    let frecuenciaTotal = 0;
    let fallasAbiertas = 0;
    let fallasRestauradas = 0;
    let intervalosMTBFValidos = 0;
    let minutosMaquinaObservados = 0;
    let minutosParoEquivalentesConfirmados = 0;
    let minutosParcialesSinPorcentaje = 0;

    for (const r of individualResults) {
      minutosMaquinaObservados += r.minutosObservados;
      frecuenciaTotal += r.frecuencia.valor;
      fallasAbiertas += r.frecuencia.fallasAbiertas;
      fallasRestauradas += r.frecuencia.fallasRestauradas;
      intervalosMTBFValidos += r.mtbf.intervalosValidos;
      minutosParoEquivalentesConfirmados += r.disponibilidad.minutosParoEquivalentes;
      minutosParcialesSinPorcentaje += r.disponibilidad.minutosParcialesSinPorcentaje;

      if (r.frecuencia.valor > 0) {
        maquinasConFallas++;
      }
    }

    return res.json({
      success: true,
      metadata: {
        zonaHoraria: "America/Mexico_City",
        agrupacion: queryParams.agrupacion,
        dimensionAgrupacion: "CATALOGO_ACTUAL",
        periodoSolicitado: {
          desde: queryParams.desde,
          hasta: queryParams.hasta,
        },
        periodoEfectivo: {
          desde: desde.toISOString(),
          hasta: hastaEfectivo.toISOString(),
        },
        periodoRecortadoAHoy,
        filtros: {
          maquinaId: queryParams.maquinaId,
          proceso: queryParams.proceso,
          area: queryParams.area,
          criticidad: queryParams.criticidad,
          estadoMaquina: queryParams.estadoMaquina,
          buscar: queryParams.buscar,
          incluirAreaNula: queryParams.incluirAreaNula,
          incluirHistoricos: queryParams.incluirHistoricos,
        },
        paginacion,
        totalMaquinasFiltradas,
        maquinasSinAreaExcluidas,
        generadoAt: ahora.toISOString(),
      },
      resumen: {
        maquinasObservadas,
        maquinasConFallas,
        frecuenciaTotal,
        fallasAbiertas,
        fallasRestauradas,
        intervalosMTBFValidos,
      minutosMaquinaObservados,
      minutosProgramados: minutosMaquinaObservados,
      minutosParoEquivalentesConfirmados,
      minutosParcialesSinPorcentaje,
      },
      summary: {
        correctivos: {
          total: metricasGlobales.frecuencia.valor,
          abiertos: metricasGlobales.frecuencia.fallasAbiertas,
          restaurados: metricasGlobales.frecuencia.fallasRestauradas,
        },
        participacionSolicitudes: {
          porcentaje: participacionSolicitudesPorcentaje,
          solicitudesFiltro: metricasGlobales.frecuencia.valor,
          solicitudesTotal: solicitudesTotalBase,
        },
        metaDisponibilidadPorcentaje: 98,
        frecuencia: metricasGlobales.frecuencia,
        mttr: metricasGlobales.mttr,
        mtbf: metricasGlobales.mtbf,
        disponibilidad: {
          ...metricasGlobales.disponibilidad,
          porcentaje: metricasGlobales.disponibilidad.valorPorcentaje,
          general: {
            porcentaje: metricasGlobales.disponibilidad.valorPorcentaje,
            minutosProgramados: metricasGlobales.disponibilidad.minutosProgramados,
            minutosParoEquivalentes: metricasGlobales.disponibilidad.minutosParoEquivalentes,
          },
          top: {
            cantidadEquipos: topRows.length,
            porcentaje: topDisponibilidadPorcentaje,
            minutosProgramados: topMinutosProgramados,
            minutosParoEquivalentes: topMinutosParoEquivalentes,
          },
        },
        minutosReparacion: metricasGlobales.mttr.sumaMinutosTrabajoTecnico,
        minutosParoProduccion: metricasGlobales.disponibilidad.minutosParoEquivalentes,
      },
      data: dataPaginada,
    });
  } catch (error) {
    await registrarError("GET_BI_KPIS", user.id, error);
    const msg = error instanceof Error ? error.message : "Error al procesar consulta BI.";
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_CALCULATION_ERROR",
        message: msg,
      },
    });
  }
};

export const getBIDetailController = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Autenticación requerida.",
      },
    });
  }
  const ahora = new Date();

  const validation = machineDetailQuerySchema.safeParse({
    params: req.params,
    query: req.query,
  });

  if (!validation.success) {
    return res.status(400).json({
      success: false,
      error: {
        code: "BI_INVALID_PARAMS",
        message: "Los parámetros de consulta son inválidos.",
        details: validation.error.issues,
      },
    });
  }

  const { maquinaId } = validation.data.params;
  const { desde, hasta, paginaEventos, limiteEventos, incluirHistoricos } = validation.data.query;

  try {
    const detail = await BIDetailService.obtenerDetalleMaquina({
      maquinaId,
      desdeStr: desde,
      hastaStr: hasta,
      paginaEventos,
      limiteEventos,
      ahora,
      incluirHistoricos,
    });

    return res.json(detail);
  } catch (error) {
    await registrarError("GET_BI_DETAIL", user.id, error);
    const msg = error instanceof Error ? error.message : "";
    if (msg === "MAQUINA_NOT_FOUND") {
      return res.status(404).json({
        success: false,
        error: {
          code: "MAQUINA_NOT_FOUND",
          message: `La máquina con ID ${maquinaId} no existe en el catálogo.`,
        },
      });
    }

    return res.status(400).json({
      success: false,
      error: {
        code: "BI_DETAIL_ERROR",
        message: msg || "Error al procesar el detalle analítico.",
      },
    });
  }
};

export const getBIFiltrosController = async (req: Request, res: Response) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({
      success: false,
      error: {
        code: "UNAUTHENTICATED",
        message: "Autenticación requerida.",
      },
    });
  }
  try {
    const filtros = await BIFilterService.obtenerFiltros();
    return res.json(filtros);
  } catch (error) {
    await registrarError("GET_BI_FILTROS", user.id, error);
    return res.status(500).json({
      success: false,
      error: {
        code: "BI_FILTERS_ERROR",
        message: "Error al obtener catálogo de filtros.",
      },
    });
  }
};
