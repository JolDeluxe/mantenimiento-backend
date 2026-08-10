import { prisma } from "../../../db";
import type { Maquina } from "@prisma/client";
import { BIQueryService } from "./bi_query_service";
import {
  calcularDomingosConActividadPorMaquina,
  calcularMinutosProgramadosMaquina,
} from "../calculations/periodos";
import { calcularFrecuencia } from "../calculations/frecuencia";
import { calcularMTTR } from "../calculations/mttr";
import { calcularMTBF } from "../calculations/mtbf";
import { calcularDisponibilidadMaquina } from "../calculations/disponibilidad";
import { calcularConfiabilidad } from "../calculations/confiabilidad";
import type { MaquinaMetricsBase } from "../calculations/aggregation";

export interface MaquinaCalculatedResult extends MaquinaMetricsBase {
  maquina: Maquina;
  calidadDatos: {
    confirmados: number;
    incompletos: number;
    provisionalesExcluidos: number;
    historicosExcluidos: number;
    invalidos: number;
    estadoGeneral: string;
    advertencias: string[];
  };
}

export class BIMetricsService {
  /**
   * Calcula las métricas individuales de un conjunto de máquinas para el periodo dado.
   */
  static async calcularMetricasMaquinas(
    maquinas: Maquina[],
    desde: Date,
    hastaEfectivo: Date,
    calidad: "CONFIRMADOS" | "CONFIRMADOS_E_INCOMPLETOS",
    ahora: Date,
    incluirHistoricos = false,
    hastaSolicitado: Date = hastaEfectivo
  ): Promise<MaquinaCalculatedResult[]> {
    const maquinasIds = maquinas.map((m) => m.id);

    // 1. Obtener datos de base de datos de manera conjunta
    const [fallasPeriodo, fallasAnteriores, paros, actividadesProgramacion] = await Promise.all([
      BIQueryService.obtenerFallasConfirmadas(maquinasIds, { desde, hastaEfectivo, calidad, incluirHistoricos }),
      BIQueryService.obtenerFallasAnteriores(maquinasIds, desde, calidad, incluirHistoricos),
      BIQueryService.obtenerIntervalosParo(maquinasIds, desde, hastaEfectivo),
      BIQueryService.obtenerActividadesProgramacion(maquinasIds, desde, hastaSolicitado),
    ]);
    const domingosConActividadPorMaquina = calcularDomingosConActividadPorMaquina(
      actividadesProgramacion,
      desde,
      hastaSolicitado,
      ahora,
    );

    // Combinar fallas para cálculo de MTBF
    const todasFallasParaMTBF = [...fallasPeriodo, ...fallasAnteriores];
    const tareaIdsFallasPeriodo = fallasPeriodo
      .map((f) => f.tareaId)
      .filter((id): id is number => id !== null);
    const intervalosTecnicos = await BIQueryService.obtenerIntervalosTecnicos(tareaIdsFallasPeriodo);
    const intervalosPorTareaId = new Map<number, typeof intervalosTecnicos>();
    for (const intervalo of intervalosTecnicos) {
      const list = intervalosPorTareaId.get(intervalo.tareaId) || [];
      list.push(intervalo);
      intervalosPorTareaId.set(intervalo.tareaId, list);
    }

    // Cargar recuentos de calidad de datos para el reporte
    // Para contar provisionales/históricos/descartados excluidos, hacemos una consulta rápida por máquina
    const conteosExcluidosRaw = await prisma.fallaMaquina.groupBy({
      by: ["maquinaId", "calidadDato", "estado", "confirmadoPorId", "contabilizaComoFalla"],
      where: {
        maquinaId: { in: maquinasIds },
        fechaFallaConfirmada: {
          gte: desde,
          lt: hastaEfectivo,
        },
      },
      _count: { id: true },
    });

    const resultados: MaquinaCalculatedResult[] = [];

    for (const maquina of maquinas) {
      const minutosProgramados = calcularMinutosProgramadosMaquina({
        maquinaCreatedAt: maquina.createdAt,
        desde,
        hastaSolicitado,
        ahora,
        domingosConActividad: domingosConActividadPorMaquina.get(maquina.id),
      });

      // Filtrar fallas y paros de esta máquina
      const fallasMaquinaPeriodo = fallasPeriodo.filter((f) => f.maquinaId === maquina.id);
      const fallasMaquinaMTBF = todasFallasParaMTBF.filter((f) => f.maquinaId === maquina.id);
      const parosMaquina = paros.filter((p) => p.maquinaId === maquina.id);

      // Calcular indicadores individuales
      const frecuencia = calcularFrecuencia(fallasMaquinaPeriodo, desde, hastaEfectivo);
      const metricasTecnicas = calcularMTTR(fallasMaquinaPeriodo, intervalosPorTareaId, desde, hastaEfectivo);
      const { mttr, tiempoRespuesta, restauracionCalendario } = metricasTecnicas;
      const disponibilidad = calcularDisponibilidadMaquina(
        parosMaquina,
        minutosProgramados,
        desde,
        hastaEfectivo,
        maquina.createdAt
      );
      const mtbf = calcularMTBF(
        fallasMaquinaMTBF,
        [maquina.id],
        desde,
        hastaEfectivo,
        minutosProgramados,
        disponibilidad.minutosParoEquivalentes
      );

      const confiabilidad = calcularConfiabilidad(mtbf.valorDias, mtbf.estado, frecuencia.valor);

      // Recuentos de calidad de datos
      let confirmados = 0;
      let incompletos = 0;
      let provisicionalesExcluidos = 0;
      let historicosExcluidos = 0;
      let invalidos = mttr.fallasInvalidasExcluidas + mtbf.intervalosInvalidos;
      const tieneHistoricosEnPeriodo = fallasMaquinaPeriodo.some(f => f.calidadDato === "HISTORICO_ESTIMADO");

      const conteosMaquina = conteosExcluidosRaw.filter((c) => c.maquinaId === maquina.id);
      for (const c of conteosMaquina) {
        if (
          !c.contabilizaComoFalla ||
          c.estado === "DESCARTADA" ||
          ((c.calidadDato === "CONFIRMADO" || c.calidadDato === "DATO_INCOMPLETO") && c.confirmadoPorId === null)
        ) {
          invalidos += c._count.id;
          continue;
        }

        if (c.calidadDato === "PROVISIONAL") {
          provisicionalesExcluidos += c._count.id;
        } else if (c.calidadDato === "HISTORICO_ESTIMADO") {
          if (incluirHistoricos) {
            historicosExcluidos = 0; // No se excluyen si el filtro está activo
          } else {
            historicosExcluidos += c._count.id;
          }
        } else if (c.calidadDato === "CONFIRMADO") {
          confirmados += c._count.id;
        } else if (c.calidadDato === "DATO_INCOMPLETO") {
          incompletos += c._count.id;
        }
      }

      // Advertencias y estado general
      const advertenciasCalidad = new Set<string>();
      if (provisicionalesExcluidos > 0) advertenciasCalidad.add("DATOS_PROVISIONALES_EXCLUIDOS");
      if (!incluirHistoricos && historicosExcluidos > 0) advertenciasCalidad.add("HISTORICO_ESTIMADO_EXCLUIDO");
      if (maquina.createdAt.getTime() > desde.getTime()) advertenciasCalidad.add("MAQUINA_CREADA_DURANTE_PERIODO");

      // Estado general de calidad
      let estadoGeneral = "SIN_DATOS";
      if (confirmados > 0 && incompletos === 0) {
        estadoGeneral = "CONFIRMADO";
      } else if (incompletos > 0) {
        estadoGeneral = "DATO_INCOMPLETO";
      } else if (provisicionalesExcluidos > 0 && confirmados === 0) {
        estadoGeneral = "PROVISIONAL";
      } else if (incluirHistoricos && tieneHistoricosEnPeriodo) {
        estadoGeneral = "HISTORICO_ESTIMADO";
      }

      resultados.push({
        maquina,
        minutosObservados: minutosProgramados,
        frecuencia,
        mttr,
        tiempoRespuesta,
        restauracionCalendario,
        mtbf,
        disponibilidad: disponibilidad as any,
        confiabilidad,
        calidadDatos: {
          confirmados,
          incompletos,
          provisionalesExcluidos: provisicionalesExcluidos,
          historicosExcluidos,
          invalidos,
          estadoGeneral,
          advertencias: Array.from(advertenciasCalidad),
        },
      });
    }

    return resultados;
  }
}
