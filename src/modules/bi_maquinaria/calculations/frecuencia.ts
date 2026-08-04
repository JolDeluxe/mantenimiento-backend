/**
 * bi_maquinaria/calculations/frecuencia.ts
 *
 * Funciones puras para cálculo de frecuencia de fallas.
 */

export interface FallaFrecuenciaInput {
  id: number;
  estado: string;
  contabilizaComoFalla: boolean;
  fechaFallaConfirmada: Date | null;
  calidadDato: string;
}

export interface FrecuenciaResult {
  valor: number;
  fallasConfirmadas: number;
  fallasAbiertas: number;
  fallasRestauradas: number;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

export function calcularFrecuencia(
  fallas: FallaFrecuenciaInput[],
  desde: Date,
  hastaEfectivo: Date
): FrecuenciaResult {
  const fallasFiltradas = fallas.filter((f) => {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) return false;
    const time = f.fechaFallaConfirmada.getTime();
    return time >= desde.getTime() && time < hastaEfectivo.getTime();
  });

  const confirmadas = fallasFiltradas.length;
  let abiertas = 0;
  let restauradas = 0;

  for (const f of fallasFiltradas) {
    if (f.estado === "ABIERTA" || f.estado === "PENDIENTE_DE_DIAGNOSTICO") {
      abiertas++;
    } else if (f.estado === "REHABILITADA" || f.estado === "CERRADA") {
      restauradas++;
    }
  }

  const result: FrecuenciaResult = {
    valor: confirmadas,
    fallasConfirmadas: confirmadas,
    fallasAbiertas: abiertas,
    fallasRestauradas: restauradas,
    estado: confirmadas > 0 ? "CALCULABLE" : "SIN_DATOS",
    advertencias: [],
  };

  if (abiertas > 0) {
    result.advertencias.push("FALLAS_ABIERTAS_EXCLUIDAS_MTTR");
  }

  return result;
}
