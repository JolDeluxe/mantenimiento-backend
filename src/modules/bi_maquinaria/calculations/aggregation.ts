/**
 * bi_maquinaria/calculations/aggregation.ts
 *
 * Funciones puras para agregar bases analíticas grupales (proceso, área)
 * antes de computar los indicadores definitivos.
 */

import type { FrecuenciaResult } from "./frecuencia";
import type { MTTRResult, RestauracionCalendarioResult, TiempoRespuestaResult } from "./mttr";
import type { MTBFResult } from "./mtbf";
import type { DisponibilidadResult } from "./disponibilidad";
import type { ConfiabilidadResult } from "./confiabilidad";
import { calcularConfiabilidad } from "./confiabilidad";

export interface MaquinaMetricsBase {
  minutosObservados: number;
  frecuencia: FrecuenciaResult;
  mttr: MTTRResult;
  tiempoRespuesta: TiempoRespuestaResult;
  restauracionCalendario: RestauracionCalendarioResult;
  mtbf: MTBFResult;
  disponibilidad: Omit<DisponibilidadResult, "minutosMaquinaObservados">;
  confiabilidad: ConfiabilidadResult;
}

export interface GroupMetricsResult {
  frecuencia: FrecuenciaResult;
  mttr: MTTRResult;
  tiempoRespuesta: TiempoRespuestaResult;
  restauracionCalendario: RestauracionCalendarioResult;
  mtbf: MTBFResult;
  disponibilidad: Omit<DisponibilidadResult, "minutosMaquinaObservados"> & {
    minutosMaquinaObservados: number;
    minutosProgramados: number;
  };
  confiabilidad: ConfiabilidadResult;
}

export function agregarMetricasGrupo(
  maquinasMetricas: MaquinaMetricsBase[]
): GroupMetricsResult {
  let totalMinutosObservados = 0;
  let totalMinutosParoEquivalentes = 0;
  let totalMinutosParcialesSinPorcentaje = 0;
  let totalMinutosParoPlanificado = 0;
  let totalIntervalosAbiertos = 0;

  let totalFallasConfirmadas = 0;
  let totalFallasAbiertas = 0;
  let totalFallasRestauradas = 0;

  let totalSumaMinutosTrabajoTecnico = 0;
  let totalSumaMinutosRespuesta = 0;
  let totalFallasRespuestaUsadas = 0;
  let totalSumaMinutosCalendarioRestauracion = 0;
  let totalFallasCalendarioRestauracionUsadas = 0;
  let totalFallasRestauradasUsadas = 0;
  let totalFallasAbiertasExcluidas = 0;
  let totalFallasInvalidasExcluidas = 0;

  let totalSumaMinutosIntervalosMTBF = 0;
  let totalIntervalosMTBFValidos = 0;
  let totalIntervalosMTBFInvalidos = 0;

  let dispTieneIncompleto = false;
  let dispTieneNoCalculable = false;

  const freqAdvertencias = new Set<string>();
  const mttrAdvertencias = new Set<string>();
  const respuestaAdvertencias = new Set<string>();
  const calendarioAdvertencias = new Set<string>();
  const mtbfAdvertencias = new Set<string>();
  const dispAdvertencias = new Set<string>();

  for (const m of maquinasMetricas) {
    // observed time & paros
    totalMinutosObservados += m.minutosObservados;
    totalMinutosParoEquivalentes += m.disponibilidad.minutosParoEquivalentes;
    totalMinutosParcialesSinPorcentaje += m.disponibilidad.minutosParcialesSinPorcentaje;
    totalMinutosParoPlanificado += m.disponibilidad.minutosParoPlanificado;
    totalIntervalosAbiertos += m.disponibilidad.intervalosAbiertos;

    if (m.disponibilidad.estado === "DATO_INCOMPLETO") {
      dispTieneIncompleto = true;
    }
    if (m.disponibilidad.estado === "NO_CALCULABLE") {
      dispTieneNoCalculable = true;
    }
    m.disponibilidad.advertencias.forEach(a => dispAdvertencias.add(a));

    // frequency
    totalFallasConfirmadas += m.frecuencia.fallasConfirmadas;
    totalFallasAbiertas += m.frecuencia.fallasAbiertas;
    totalFallasRestauradas += m.frecuencia.fallasRestauradas;
    m.frecuencia.advertencias.forEach(a => freqAdvertencias.add(a));

    // mttr
    totalSumaMinutosTrabajoTecnico += m.mttr.sumaMinutosTrabajoTecnico;
    totalFallasRestauradasUsadas += m.mttr.fallasRestauradasUsadas;
    totalFallasAbiertasExcluidas += m.mttr.fallasAbiertasExcluidas;
    totalFallasInvalidasExcluidas += m.mttr.fallasInvalidasExcluidas;
    m.mttr.advertencias.forEach(a => mttrAdvertencias.add(a));

    totalSumaMinutosRespuesta += m.tiempoRespuesta.sumaMinutos;
    totalFallasRespuestaUsadas += m.tiempoRespuesta.fallasUsadas;
    m.tiempoRespuesta.advertencias.forEach(a => respuestaAdvertencias.add(a));

    totalSumaMinutosCalendarioRestauracion += m.restauracionCalendario.sumaMinutos;
    totalFallasCalendarioRestauracionUsadas += m.restauracionCalendario.fallasUsadas;
    m.restauracionCalendario.advertencias.forEach(a => calendarioAdvertencias.add(a));

    // mtbf
    totalSumaMinutosIntervalosMTBF += m.mtbf.sumaMinutosIntervalos;
    totalIntervalosMTBFValidos += m.mtbf.intervalosValidos;
    totalIntervalosMTBFInvalidos += m.mtbf.intervalosInvalidos;
    m.mtbf.advertencias.forEach(a => mtbfAdvertencias.add(a));
  }

  // 1. Frecuencia final
  const frecuencia: FrecuenciaResult = {
    valor: totalFallasConfirmadas,
    fallasConfirmadas: totalFallasConfirmadas,
    fallasAbiertas: totalFallasAbiertas,
    fallasRestauradas: totalFallasRestauradas,
    estado: totalFallasConfirmadas > 0 ? "CALCULABLE" : "SIN_DATOS",
    advertencias: Array.from(freqAdvertencias),
  };

  // 2. MTTR final
  let mttrValor: number | null = 0;
  let mttrEstado: MTTRResult["estado"] = "SIN_DATOS";
  if (totalFallasConfirmadas === 0) {
    mttrEstado = "SIN_DATOS";
  } else if (totalFallasRestauradasUsadas === 0) {
    mttrEstado = "MUESTRA_INSUFICIENTE";
    mttrAdvertencias.add("FALLAS_RESTAURADAS_INSUFICIENTES");
  } else {
    mttrValor = totalSumaMinutosTrabajoTecnico / totalFallasRestauradasUsadas;
    mttrEstado = "CALCULABLE";
  }
  const mttr: MTTRResult = {
    valorMinutos: mttrValor,
    sumaMinutosTrabajoTecnico: totalSumaMinutosTrabajoTecnico,
    sumaMinutosRestauracion: totalSumaMinutosTrabajoTecnico,
    fallasRestauradasUsadas: totalFallasRestauradasUsadas,
    fallasAbiertasExcluidas: totalFallasAbiertasExcluidas,
    fallasInvalidasExcluidas: totalFallasInvalidasExcluidas,
    estado: mttrEstado,
    advertencias: Array.from(mttrAdvertencias),
  };

  const buildPromedioMetric = (
    suma: number,
    usadas: number,
    warnings: Set<string>,
  ): TiempoRespuestaResult => {
    let estado: TiempoRespuestaResult["estado"] = "SIN_DATOS";
    let valorPromedioMinutos: number | null = null;
    if (totalFallasConfirmadas === 0) {
      estado = "SIN_DATOS";
    } else if (usadas === 0) {
      estado = "MUESTRA_INSUFICIENTE";
    } else {
      estado = "CALCULABLE";
      valorPromedioMinutos = suma / usadas;
    }
    return {
      valorPromedioMinutos,
      sumaMinutos: suma,
      fallasUsadas: usadas,
      estado,
      advertencias: Array.from(warnings),
    };
  };

  const tiempoRespuesta = buildPromedioMetric(
    totalSumaMinutosRespuesta,
    totalFallasRespuestaUsadas,
    respuestaAdvertencias,
  );

  const restauracionCalendario: RestauracionCalendarioResult = buildPromedioMetric(
    totalSumaMinutosCalendarioRestauracion,
    totalFallasCalendarioRestauracionUsadas,
    calendarioAdvertencias,
  );

  // 3. MTBF final: modelo programado agregado, no promedio de MTBF por máquina.
  const minutosOperativosProgramados = Math.max(
    0,
    totalMinutosObservados - totalMinutosParoEquivalentes,
  );
  const mtbfCensurado = totalFallasConfirmadas === 0;
  const mtbfValorMinutos = totalMinutosObservados <= 0
    ? null
    : mtbfCensurado
      ? minutosOperativosProgramados
      : minutosOperativosProgramados / totalFallasConfirmadas;
  const mtbfValorDias = mtbfValorMinutos === null ? null : mtbfValorMinutos / 540;
  const mtbfEstado: MTBFResult["estado"] = totalMinutosObservados <= 0 ? "SIN_DATOS" : "CALCULABLE";
  if (mtbfCensurado && totalMinutosObservados > 0) {
    mtbfAdvertencias.add("MTBF_CENSURADO_SIN_FALLAS");
  }
  const mtbf: MTBFResult = {
    valorDias: mtbfValorDias,
    valorMinutos: mtbfValorMinutos,
    sumaMinutosIntervalos: minutosOperativosProgramados,
    intervalosValidos: totalFallasConfirmadas,
    intervalosInvalidos: totalIntervalosMTBFInvalidos,
    maquinasConIntervalos: maquinasMetricas.filter(m => m.minutosObservados > 0).length,
    frecuenciaBase: totalFallasConfirmadas,
    minutosOperativosProgramados,
    censurado: mtbfCensurado,
    estado: mtbfEstado,
    advertencias: Array.from(mtbfAdvertencias),
  };

  // 4. Disponibilidad final
  let dispValor: number | null = null;
  let dispConocidos: number | null = null;
  let dispEstado: DisponibilidadResult["estado"] = "CALCULABLE";

  if (totalMinutosObservados <= 0) {
    dispEstado = "SIN_DATOS";
  } else if (dispTieneNoCalculable) {
    dispEstado = "NO_CALCULABLE";
  } else if (dispTieneIncompleto) {
    dispEstado = "DATO_INCOMPLETO";
    dispConocidos = ((totalMinutosObservados - totalMinutosParoEquivalentes) / totalMinutosObservados) * 100;
  } else {
    dispValor = ((totalMinutosObservados - totalMinutosParoEquivalentes) / totalMinutosObservados) * 100;
    dispConocidos = dispValor;
  }

  // Clampear a 100
  if (dispValor !== null && dispValor > 100) dispValor = 100;
  if (dispConocidos !== null && dispConocidos > 100) dispConocidos = 100;

  const disponibilidad = {
    valorPorcentaje: dispValor,
    disponibilidadConDatosConocidosPorcentaje: dispConocidos,
    minutosMaquinaObservados: totalMinutosObservados,
    minutosProgramados: totalMinutosObservados,
    minutosParoEquivalentes: totalMinutosParoEquivalentes,
    minutosParcialesSinPorcentaje: totalMinutosParcialesSinPorcentaje,
    minutosParoPlanificado: totalMinutosParoPlanificado,
    intervalosAbiertos: totalIntervalosAbiertos,
    estado: dispEstado,
    advertencias: Array.from(dispAdvertencias),
  };

  // 5. Confiabilidad final
  const confiabilidad = calcularConfiabilidad(mtbf.valorDias, mtbf.estado, frecuencia.valor);

  return {
    frecuencia,
    mttr,
    tiempoRespuesta,
    restauracionCalendario,
    mtbf,
    disponibilidad,
    confiabilidad,
  };
}
