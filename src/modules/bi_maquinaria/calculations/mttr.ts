/**
 * bi_maquinaria/calculations/mttr.ts
 *
 * Funciones puras para el cálculo de MTTR (Mean Time To Restoration).
 */

export interface FallaMTTRInput {
  id: number;
  fechaFallaConfirmada: Date | null;
  fechaRestauracion: Date | null;
  estado: string;
  contabilizaComoFalla: boolean;
}

export interface MTTRResult {
  valorMinutos: number | null;
  sumaMinutosRestauracion: number;
  fallasRestauradasUsadas: number;
  fallasAbiertasExcluidas: number;
  fallasInvalidasExcluidas: number;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

export function calcularMTTR(
  fallas: FallaMTTRInput[],
  desde: Date,
  hastaEfectivo: Date
): MTTRResult {
  let sumaMinutos = 0;
  let usadas = 0;
  let abiertas = 0;
  let invalidas = 0;
  let totalFallasConfirmadas = 0;
  const advertencias: string[] = [];

  for (const f of fallas) {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) continue;

    const confirmadaTime = f.fechaFallaConfirmada.getTime();
    if (confirmadaTime < desde.getTime() || confirmadaTime >= hastaEfectivo.getTime()) {
      continue;
    }

    totalFallasConfirmadas++;

    if (f.estado === "ABIERTA" || !f.fechaRestauracion) {
      abiertas++;
      continue;
    }

    const restTime = f.fechaRestauracion.getTime();
    const diffMins = (restTime - confirmadaTime) / 60000;

    if (diffMins < 0) {
      invalidas++;
      advertencias.push("FECHA_RESTAURACION_INVALIDA");
      continue;
    }

    sumaMinutos += diffMins;
    usadas++;
  }

  let valor: number | null = null;
  let estado: MTTRResult["estado"] = "SIN_DATOS";

  if (totalFallasConfirmadas === 0) {
    estado = "SIN_DATOS";
  } else if (usadas === 0) {
    estado = "MUESTRA_INSUFICIENTE";
    advertencias.push("FALLAS_RESTAURADAS_INSUFICIENTES");
  } else {
    valor = sumaMinutos / usadas;
    estado = "CALCULABLE";
  }

  if (abiertas > 0 && !advertencias.includes("FALLAS_ABIERTAS_EXCLUIDAS_MTTR")) {
    advertencias.push("FALLAS_ABIERTAS_EXCLUIDAS_MTTR");
  }

  return {
    valorMinutos: valor,
    sumaMinutosRestauracion: sumaMinutos,
    fallasRestauradasUsadas: usadas,
    fallasAbiertasExcluidas: abiertas,
    fallasInvalidasExcluidas: invalidas,
    estado,
    advertencias: Array.from(new Set(advertencias)),
  };
}
