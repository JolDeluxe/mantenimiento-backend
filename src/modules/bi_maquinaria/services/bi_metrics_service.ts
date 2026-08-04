import { prisma } from "../../../db";
import type { Maquina } from "@prisma/client";
import { BIQueryService } from "./bi_query_service";
import { calcularMinutosObservadosMaquina } from "../calculations/periodos";
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
    ahora: Date
  ): Promise<MaquinaCalculatedResult[]> {
    const maquinasIds = maquinas.map((m) => m.id);

    // 1. Obtener datos de base de datos de manera conjunta
    const [fallasPeriodo, fallasAnteriores, paros] = await Promise.all([
      BIQueryService.obtenerFallasConfirmadas(maquinasIds, { desde, hastaEfectivo, calidad }),
      BIQueryService.obtenerFallasAnteriores(maquinasIds, desde, calidad),
      BIQueryService.obtenerIntervalosParo(maquinasIds, desde, hastaEfectivo),
    ]);

    // Combinar fallas para cálculo de MTBF
    const todasFallasParaMTBF = [...fallasPeriodo, ...fallasAnteriores];

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
      const minutosObservados = calcularMinutosObservadosMaquina({
        maquinaCreatedAt: maquina.createdAt,
        desde,
        hastaEfectivo,
      });

      // Filtrar fallas y paros de esta máquina
      const fallasMaquinaPeriodo = fallasPeriodo.filter((f) => f.maquinaId === maquina.id);
      const fallasMaquinaMTBF = todasFallasParaMTBF.filter((f) => f.maquinaId === maquina.id);
      const parosMaquina = paros.filter((p) => p.maquinaId === maquina.id);

      // Calcular indicadores individuales
      const frecuencia = calcularFrecuencia(fallasMaquinaPeriodo, desde, hastaEfectivo);
      const mttr = calcularMTTR(fallasMaquinaPeriodo, desde, hastaEfectivo);
      const mtbf = calcularMTBF(fallasMaquinaMTBF, [maquina.id], desde, hastaEfectivo);

      const disponibilidad = calcularDisponibilidadMaquina(
        parosMaquina,
        minutosObservados,
        desde,
        hastaEfectivo,
        maquina.createdAt
      );

      const confiabilidad = calcularConfiabilidad(mtbf.valorDias, mtbf.estado);

      // Recuentos de calidad de datos
      let confirmados = 0;
      let incompletos = 0;
      let provisicionalesExcluidos = 0;
      let historicosExcluidos = 0;
      let invalidos = mttr.fallasInvalidasExcluidas + mtbf.intervalosInvalidos;

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
          historicosExcluidos += c._count.id;
        } else if (c.calidadDato === "CONFIRMADO") {
          confirmados += c._count.id;
        } else if (c.calidadDato === "DATO_INCOMPLETO") {
          incompletos += c._count.id;
        }
      }

      // Advertencias y estado general
      const advertenciasCalidad = new Set<string>();
      if (provisicionalesExcluidos > 0) advertenciasCalidad.add("DATOS_PROVISIONALES_EXCLUIDOS");
      if (historicosExcluidos > 0) advertenciasCalidad.add("HISTORICO_ESTIMADO_EXCLUIDO");
      if (maquina.createdAt.getTime() > desde.getTime()) advertenciasCalidad.add("MAQUINA_CREADA_DURANTE_PERIODO");

      // Si hasta fue recortado
      if (hastaEfectivo.getTime() < new Date(desde.getTime() + (hastaEfectivo.getTime() - desde.getTime())).getTime()) {
        // En este contexto el recortado lo maneja el controlador, pero podemos agregarlo si aplica
      }

      // Estado general de calidad
      let estadoGeneral = "SIN_DATOS";
      if (confirmados > 0 && incompletos === 0) {
        estadoGeneral = "CONFIRMADO";
      } else if (incompletos > 0) {
        estadoGeneral = "DATO_INCOMPLETO";
      } else if (provisicionalesExcluidos > 0 && confirmados === 0) {
        estadoGeneral = "PROVISIONAL";
      }

      resultados.push({
        maquina,
        minutosObservados,
        frecuencia,
        mttr,
        mtbf,
        disponibilidad,
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
