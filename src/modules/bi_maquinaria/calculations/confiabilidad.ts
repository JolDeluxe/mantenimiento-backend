/**
 * bi_maquinaria/calculations/confiabilidad.ts
 *
 * Funciones puras para el cálculo de la confiabilidad estimada (modelo exponencial).
 */

export interface ConfiabilidadResult {
  r1DiaPorcentaje: number | null;
  r7DiasPorcentaje: number | null;
  r30DiasPorcentaje: number | null;
  r90DiasPorcentaje: number | null;
  mtbfBaseDias: number | null;
  modelo: "EXPONENCIAL";
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

export function calcularConfiabilidad(
  mtbfDias: number | null,
  mtbfEstado: string
): ConfiabilidadResult {
  const result: ConfiabilidadResult = {
    r1DiaPorcentaje: null,
    r7DiasPorcentaje: null,
    r30DiasPorcentaje: null,
    r90DiasPorcentaje: null,
    mtbfBaseDias: mtbfDias,
    modelo: "EXPONENCIAL",
    estado: "SIN_DATOS",
    advertencias: [],
  };

  if (mtbfDias === null) {
    result.estado = mtbfEstado as ConfiabilidadResult["estado"];
    return result;
  }

  if (mtbfDias <= 0) {
    result.estado = "NO_CALCULABLE";
    return result;
  }

  result.estado = "CALCULABLE";

  // R(t) = exp(-t / MTBF_días) * 100
  result.r1DiaPorcentaje = Math.exp(-1 / mtbfDias) * 100;
  result.r7DiasPorcentaje = Math.exp(-7 / mtbfDias) * 100;
  result.r30DiasPorcentaje = Math.exp(-30 / mtbfDias) * 100;
  result.r90DiasPorcentaje = Math.exp(-90 / mtbfDias) * 100;

  // Clampear entre 0 y 100
  result.r1DiaPorcentaje = Math.max(0, Math.min(100, result.r1DiaPorcentaje));
  result.r7DiasPorcentaje = Math.max(0, Math.min(100, result.r7DiasPorcentaje));
  result.r30DiasPorcentaje = Math.max(0, Math.min(100, result.r30DiasPorcentaje));
  result.r90DiasPorcentaje = Math.max(0, Math.min(100, result.r90DiasPorcentaje));

  return result;
}
