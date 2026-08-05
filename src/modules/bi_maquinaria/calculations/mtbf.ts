/**
 * bi_maquinaria/calculations/mtbf.ts
 *
 * Funciones puras para el cálculo de MTBF (Mean Time Between Failures).
 *
 * Modelo BI programado:
 * MTBF dias = minutos operativos programados / frecuencia / 540.
 * Si frecuencia = 0, se reporta el periodo observado como dato censurado
 * hacia la derecha: "al menos X dias sin fallas".
 */

export interface FallaMTBFInput {
  id: number;
  maquinaId: number;
  fechaFallaConfirmada: Date | null;
  fechaRestauracion: Date | null;
  estado: string;
  contabilizaComoFalla: boolean;
}

export interface MTBFResult {
  valorDias: number | null;
  valorMinutos: number | null;
  sumaMinutosIntervalos: number;
  intervalosValidos: number;
  intervalosInvalidos: number;
  maquinasConIntervalos: number;
  frecuenciaBase: number;
  minutosOperativosProgramados: number;
  censurado: boolean;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

const MINUTOS_DIA_PROGRAMADO_BASE = 540;

export function calcularMTBF(
  fallasMaquina: FallaMTBFInput[],
  _maquinasIds: number[],
  desde: Date,
  hastaEfectivo: Date,
  minutosProgramados = 0,
  minutosParoNoPlanificadoEquivalentes = 0,
): MTBFResult {
  const advertencias = new Set<string>();

  const frecuencia = fallasMaquina.filter(f => {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) return false;
    const t = f.fechaFallaConfirmada.getTime();
    return t >= desde.getTime() && t < hastaEfectivo.getTime();
  }).length;

  const minutosOperativosProgramados = Math.max(
    0,
    minutosProgramados - minutosParoNoPlanificadoEquivalentes,
  );

  if (minutosProgramados <= 0) {
    return {
      valorDias: null,
      valorMinutos: null,
      sumaMinutosIntervalos: 0,
      intervalosValidos: 0,
      intervalosInvalidos: 0,
      maquinasConIntervalos: 0,
      frecuenciaBase: frecuencia,
      minutosOperativosProgramados,
      censurado: false,
      estado: "SIN_DATOS",
      advertencias: ["SIN_MINUTOS_PROGRAMADOS"],
    };
  }

  const censurado = frecuencia === 0;
  const valorMinutos = censurado
    ? minutosOperativosProgramados
    : minutosOperativosProgramados / frecuencia;
  const valorDias = valorMinutos / MINUTOS_DIA_PROGRAMADO_BASE;

  if (censurado) {
    advertencias.add("MTBF_CENSURADO_SIN_FALLAS");
  }

  return {
    valorDias,
    valorMinutos,
    sumaMinutosIntervalos: minutosOperativosProgramados,
    intervalosValidos: frecuencia,
    intervalosInvalidos: 0,
    maquinasConIntervalos: minutosOperativosProgramados > 0 ? 1 : 0,
    frecuenciaBase: frecuencia,
    minutosOperativosProgramados,
    censurado,
    estado: "CALCULABLE",
    advertencias: Array.from(advertencias),
  };
}
