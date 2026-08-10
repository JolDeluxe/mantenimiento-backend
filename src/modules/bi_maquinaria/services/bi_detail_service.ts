import { prisma } from "../../../db";
import { CalidadDato, EstadoFalla, TipoParo } from "@prisma/client";
import { BIMetricsService } from "./bi_metrics_service";
import { BIQueryService } from "./bi_query_service";
import { validarYCalcularPeriodo } from "../calculations/periodos";
import { normalizarIntervalosTecnicosFalla, type IntervaloTecnicoInvalido, type IntervaloTecnicoInput, type IntervaloTecnicoNormalizado } from "../calculations/mttr";

export interface MachineDetailInput {
  maquinaId: number;
  desdeStr: string;
  hastaStr: string;
  paginaEventos: number;
  limiteEventos: number;
  ahora: Date;
  incluirHistoricos?: boolean;
}

interface BIUserSummary {
  id: number;
  nombre: string;
}

interface BIDetailFallaData {
  id: number;
  tareaId: number | null;
  estado: string;
  calidadDato: string;
  contabilizaComoFalla: boolean;
  fechaFallaReportada: Date;
  fechaFallaConfirmada: Date | null;
  fechaRestauracion: Date | null;
  confirmadoPor: BIUserSummary | null;
  snapshot: {
    codigo: string;
    planta: string | null;
    area: string | null;
    proceso: string;
    criticidad: string | null;
  };
  duracionMinutos: number | null;
  primerInicioTecnico: Date | null;
  tiempoRespuestaMinutos: number | null;
  tiempoTecnicoActivoMinutos: number | null;
  tiempoCalendarioRestauracionMinutos: number | null;
  intervalosTecnicosOriginales: IntervaloTecnicoInput[];
  intervalosTecnicosEfectivos: IntervaloTecnicoNormalizado[];
  intervalosTecnicosFusionados: IntervaloTecnicoNormalizado[];
  intervalosTecnicosInvalidos: IntervaloTecnicoInvalido[];
  advertenciasTecnicas: string[];
  excluidoMTTR: boolean;
  razonExclusion: string | null;
}

interface BIDetailParoNoPlanificadoData {
  id: number;
  fallaId: number | null;
  tareaId: number | null;
  tipo: string;
  impacto: string;
  porcentajeAfectacion: number | null;
  calidadDato: string;
  inicioOriginal: Date;
  finOriginal: Date | null;
  inicioEfectivo: Date;
  finEfectivo: Date;
  duracionEfectiva: number;
  abierto: boolean;
  confirmadoPor: BIUserSummary;
}

interface BIDetailParoPlanificadoData {
  id: number;
  inicio: Date;
  fin: Date | null;
  confirmadoPor: BIUserSummary;
}

type BIDetailEvent =
  | {
      tipo: "FALLA";
      fecha: Date;
      datos: BIDetailFallaData;
    }
  | {
      tipo: "PARO_NO_PLANIFICADO";
      fecha: Date;
      datos: BIDetailParoNoPlanificadoData;
    }
  | {
      tipo: "PARO_PLANIFICADO";
      fecha: Date;
      datos: BIDetailParoPlanificadoData;
    };

interface BIDetailMTBFInterval {
  fallaAnteriorId: number;
  fallaSiguienteId: number;
  desde: Date | null;
  hasta: Date;
  minutos: number | null;
  valido: boolean;
  razonInvalida: string | null;
}

const estadosIncluidos = new Set([EstadoFalla.ABIERTA, EstadoFalla.REHABILITADA, EstadoFalla.CERRADA]);

const calidadesIncluidas = new Set<CalidadDato>([
  CalidadDato.CONFIRMADO,
  CalidadDato.DATO_INCOMPLETO,
]);

function razonExclusionFalla(falla: {
  estado: EstadoFalla;
  calidadDato: CalidadDato;
  contabilizaComoFalla: boolean;
  fechaFallaConfirmada: Date | null;
  confirmadoPorId: number | null;
}): string | null {
  if (falla.estado === EstadoFalla.DESCARTADA) return "DESCARTADA";
  if (!falla.contabilizaComoFalla) return "NO_CONTABILIZA_COMO_FALLA";
  if (!falla.fechaFallaConfirmada) return "SIN_FECHA_FALLA_CONFIRMADA";
  if (!falla.confirmadoPorId && falla.calidadDato !== CalidadDato.HISTORICO_ESTIMADO) return "SIN_CONFIRMADOR";
  if (!Array.from(estadosIncluidos).includes(falla.estado as any)) return "ESTADO_NO_INCLUIDO";
  return null;
}

export class BIDetailService {
  /**
   * Obtiene la vista analítica detallada de una máquina.
   */
  static async obtenerDetalleMaquina(input: MachineDetailInput) {
    const { maquinaId, desdeStr, hastaStr, paginaEventos, limiteEventos, ahora, incluirHistoricos = false } = input;

    const { desde, hasta, hastaEfectivo, periodoRecortadoAHoy } = validarYCalcularPeriodo({
      desdeStr,
      hastaStr,
      ahora,
    });

    const maquina = await prisma.maquina.findUnique({
      where: { id: maquinaId },
    });

    if (!maquina) {
      throw new Error("MAQUINA_NOT_FOUND");
    }

    // Calcular las métricas usando el servicio principal (calidad = CONFIRMADOS_E_INCOMPLETOS por defecto para detalles)
    const [resultado] = await BIMetricsService.calcularMetricasMaquinas(
      [maquina],
      desde,
      hastaEfectivo,
      "CONFIRMADOS_E_INCOMPLETOS",
      ahora,
      incluirHistoricos,
      hasta
    );
    if (!resultado) {
      throw new Error("BI_DETAIL_RESULT_NOT_FOUND");
    }

    const calidades: CalidadDato[] = [CalidadDato.CONFIRMADO, CalidadDato.DATO_INCOMPLETO];
    if (incluirHistoricos) {
      calidades.push(CalidadDato.HISTORICO_ESTIMADO);
    }

    // Obtener todos los eventos para listados y paginación
    const fallas = await prisma.fallaMaquina.findMany({
      where: {
        maquinaId,
        fechaFallaConfirmada: {
          gte: desde,
          lt: hastaEfectivo,
        },
        calidadDato: { in: calidades },
        OR: [
          { calidadDato: CalidadDato.HISTORICO_ESTIMADO },
          { confirmadoPorId: { not: null } },
        ],
      },
      include: {
        confirmadoPor: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { fechaFallaConfirmada: "desc" },
    });

    const fallaAnterior = await prisma.fallaMaquina.findFirst({
      where: {
        maquinaId,
        contabilizaComoFalla: true,
        estado: { in: Array.from(estadosIncluidos) },
        calidadDato: { in: calidades },
        fechaFallaConfirmada: { lt: desde },
        OR: [
          { calidadDato: CalidadDato.HISTORICO_ESTIMADO },
          { confirmadoPorId: { not: null } },
        ],
      },
      orderBy: { fechaFallaConfirmada: "desc" },
    });

    const paros = await prisma.intervaloParoMaquina.findMany({
      where: {
        maquinaId,
        inicio: { lt: hastaEfectivo },
        OR: [
          { fin: null },
          { fin: { gt: desde } },
        ],
      },
      include: {
        confirmadoPor: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
      orderBy: { inicio: "desc" },
    });

    // Separar paros planeados
    const parosNoPlanificados = paros.filter((p) => p.tipo === "NO_PLANIFICADO");
    const parosPlanificados = paros.filter((p) => p.tipo === "PLANIFICADO");

    const tareaIdsFallas = fallas
      .map((f) => f.tareaId)
      .filter((id): id is number => id !== null);
    const intervalosTecnicos = await BIQueryService.obtenerIntervalosTecnicos(tareaIdsFallas);
    const intervalosPorTareaId = new Map<number, typeof intervalosTecnicos>();
    for (const intervalo of intervalosTecnicos) {
      const list = intervalosPorTareaId.get(intervalo.tareaId) || [];
      list.push(intervalo);
      intervalosPorTareaId.set(intervalo.tareaId, list);
    }

    // Formatear eventos para retorno
    const eventosFallas: BIDetailFallaData[] = fallas.map((f) => {
      const intervalos = f.tareaId ? (intervalosPorTareaId.get(f.tareaId) ?? []) : [];
      const detalleTecnico = normalizarIntervalosTecnicosFalla(f, intervalos);
      const razonBase = razonExclusionFalla(f);
      const razonExclusion = razonBase
        ?? (detalleTecnico.razonExclusion === "FALLA_ABIERTA_MTTR" ? "FALLA_ABIERTA_MTTR" : detalleTecnico.razonExclusion);

      return {
        id: f.id,
        tareaId: f.tareaId,
        estado: f.estado,
        calidadDato: f.calidadDato,
        contabilizaComoFalla: f.contabilizaComoFalla,
        fechaFallaReportada: f.fechaFallaReportada,
        fechaFallaConfirmada: f.fechaFallaConfirmada,
        fechaRestauracion: f.fechaRestauracion,
        confirmadoPor: f.confirmadoPor,
        snapshot: {
          codigo: f.snapshotCodigo,
          planta: f.snapshotPlanta,
          area: f.snapshotArea,
          proceso: f.snapshotProceso,
          criticidad: f.snapshotCriticidad,
        },
        duracionMinutos: detalleTecnico.tiempoTecnicoActivoMinutos,
        primerInicioTecnico: detalleTecnico.primerInicioTecnico,
        tiempoRespuestaMinutos: detalleTecnico.tiempoRespuestaMinutos,
        tiempoTecnicoActivoMinutos: detalleTecnico.tiempoTecnicoActivoMinutos,
        tiempoCalendarioRestauracionMinutos: detalleTecnico.tiempoCalendarioRestauracionMinutos,
        intervalosTecnicosOriginales: detalleTecnico.intervalosOriginales,
        intervalosTecnicosEfectivos: detalleTecnico.intervalosEfectivos,
        intervalosTecnicosFusionados: detalleTecnico.intervalosFusionados,
        intervalosTecnicosInvalidos: detalleTecnico.intervalosInvalidos,
        advertenciasTecnicas: detalleTecnico.advertencias,
        excluidoMTTR: !detalleTecnico.calculable,
        razonExclusion,
      };
    });

    const fallasIncluidas = eventosFallas.filter((f) => f.razonExclusion === null || f.razonExclusion === "FALLA_ABIERTA_MTTR");
    const fallasExcluidas = eventosFallas.filter((event) => {
      const source = fallas.find((falla) => falla.id === event.id);
      return source ? razonExclusionFalla(source) !== null : false;
    });
    const fallasAbiertas = fallasIncluidas.filter((f) => f.estado === EstadoFalla.ABIERTA);
    const fallasRestauradas = fallasIncluidas.filter((f) => f.fechaRestauracion !== null);

    const fallasParaMTBF = [
      ...(fallaAnterior ? [fallaAnterior] : []),
      ...fallas.filter((f) => razonExclusionFalla(f) === null),
    ]
      .filter((f): f is typeof f & { fechaFallaConfirmada: Date } => f.fechaFallaConfirmada !== null)
      .sort((a, b) => a.fechaFallaConfirmada.getTime() - b.fechaFallaConfirmada.getTime());

    const intervalosMTBF: BIDetailMTBFInterval[] = [];
    let prevFalla: (typeof fallasParaMTBF)[number] | null = null;
    for (const current of fallasParaMTBF) {
      const currentTime = current.fechaFallaConfirmada.getTime();
      if (currentTime < desde.getTime() || currentTime >= hastaEfectivo.getTime()) {
        prevFalla = current;
        continue;
      }

      if (prevFalla) {
        const prevRest = prevFalla.fechaRestauracion;
        let minutos: number | null = null;
        let valido = false;
        let razonInvalida: string | null = null;

        if (!prevRest || prevFalla.estado === EstadoFalla.ABIERTA) {
          razonInvalida = "FALLA_ANTERIOR_ABIERTA";
        } else if (prevRest.getTime() > currentTime) {
          razonInvalida = "INTERVALO_SOLAPADO";
        } else {
          minutos = (currentTime - prevRest.getTime()) / 60000;
          valido = minutos > 0;
          razonInvalida = valido ? null : "INTERVALO_NO_POSITIVO";
        }

        intervalosMTBF.push({
          fallaAnteriorId: prevFalla.id,
          fallaSiguienteId: current.id,
          desde: prevRest,
          hasta: current.fechaFallaConfirmada,
          minutos,
          valido,
          razonInvalida,
        });
      }

      prevFalla = current;
    }

    const parosOriginales = paros.map((p) => ({
      id: p.id,
      fallaId: p.fallaId,
      tareaId: p.tareaId,
      tipo: p.tipo,
      impacto: p.impacto,
      porcentajeAfectacion: p.porcentajeAfectacion,
      calidadDato: p.calidadDato,
      inicio: p.inicio,
      fin: p.fin,
      confirmadoPor: p.confirmadoPor,
    }));

    const eventosParos: BIDetailParoNoPlanificadoData[] = parosNoPlanificados.map((p) => {
      const inicioReal = p.inicio;
      const finReal = p.fin ? p.fin : hastaEfectivo;
      const inicioEfectivo = new Date(Math.max(inicioReal.getTime(), desde.getTime()));
      const finEfectivo = new Date(Math.min(finReal.getTime(), hastaEfectivo.getTime()));
      const duracionEfectiva = Math.max(0, (finEfectivo.getTime() - inicioEfectivo.getTime()) / 60000);

      return {
        id: p.id,
        fallaId: p.fallaId,
        tareaId: p.tareaId,
        tipo: p.tipo,
        impacto: p.impacto,
        porcentajeAfectacion: p.porcentajeAfectacion,
        calidadDato: p.calidadDato,
        inicioOriginal: p.inicio,
        finOriginal: p.fin,
        inicioEfectivo,
        finEfectivo,
        duracionEfectiva,
        abierto: !p.fin,
        confirmadoPor: p.confirmadoPor,
      };
    });

    // Paginación de eventos (combinados en un feed ordenado por fecha de inicio)
    const feedEventos: BIDetailEvent[] = [
      ...eventosFallas.map((f): BIDetailEvent => ({ tipo: "FALLA", fecha: f.fechaFallaConfirmada || f.fechaFallaReportada, datos: f })),
      ...eventosParos.map((p): BIDetailEvent => ({ tipo: "PARO_NO_PLANIFICADO", fecha: p.inicioOriginal, datos: p })),
      ...parosPlanificados.map((p) => ({
        tipo: "PARO_PLANIFICADO",
        fecha: p.inicio,
        datos: {
          id: p.id,
          inicio: p.inicio,
          fin: p.fin,
          confirmadoPor: p.confirmadoPor,
        },
      }) satisfies BIDetailEvent),
    ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

    const totalEventos = feedEventos.length;
    const totalPaginasEventos = Math.ceil(totalEventos / limiteEventos);
    const eventosPaginados = feedEventos.slice(
      (paginaEventos - 1) * limiteEventos,
      paginaEventos * limiteEventos
    );

    return {
      success: true,
      metadata: {
        zonaHoraria: "America/Mexico_City",
        periodoSolicitado: { desde: desdeStr, hasta: hastaStr },
        periodoEfectivo: { desde: desde.toISOString(), hasta: hastaEfectivo.toISOString() },
        periodoRecortadoAHoy,
        paginacionEventos: {
          pagina: paginaEventos,
          limite: limiteEventos,
          totalRegistros: totalEventos,
          totalPaginas: totalPaginasEventos,
        },
        generadoAt: ahora.toISOString(),
      },
      maquina: {
        id: maquina.id,
        codigo: maquina.codigo,
        nombre: maquina.nombre,
        proceso: maquina.proceso,
        criticidad: maquina.criticidad,
        estadoActual: maquina.estado,
        area: maquina.area,
        planta: maquina.planta,
        marca: maquina.marca,
        modelo: maquina.modelo,
        numeroSerie: maquina.numeroSerie,
      },
      metricas: {
        frecuencia: resultado.frecuencia,
        mttr: resultado.mttr,
        tiempoRespuesta: resultado.tiempoRespuesta,
        restauracionCalendario: resultado.restauracionCalendario,
        mtbf: resultado.mtbf,
        disponibilidad: {
          ...resultado.disponibilidad,
          minutosMaquinaObservados: resultado.minutosObservados,
          minutosProgramados: resultado.minutosObservados,
        },
        confiabilidad: resultado.confiabilidad,
      },
      calidadDatos: resultado.calidadDatos,
      fallas: {
        incluidas: fallasIncluidas,
        excluidas: fallasExcluidas,
        abiertas: fallasAbiertas,
        restauradas: fallasRestauradas,
      },
      mtbf: {
        intervalos: intervalosMTBF,
      },
      paros: {
        originales: parosOriginales,
        recortados: eventosParos,
        planificados: parosOriginales.filter((p) => p.tipo === TipoParo.PLANIFICADO),
      },
      eventos: eventosPaginados,
    };
  }
}
