/**
 * bi_maquinaria/calculations/mtbf.ts
 *
 * Funciones puras para el cálculo de MTBF (Mean Time Between Failures).
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
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

type FallaMTBFConfirmada = FallaMTBFInput & {
  fechaFallaConfirmada: Date;
};

export function calcularMTBF(
  fallasMaquina: FallaMTBFInput[],
  maquinasIds: number[],
  desde: Date,
  hastaEfectivo: Date
): MTBFResult {
  // Agrupar fallas por máquina
  const fallasPorMaquina = new Map<number, FallaMTBFConfirmada[]>();
  for (const f of fallasMaquina) {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) continue;
    const list = fallasPorMaquina.get(f.maquinaId) || [];
    list.push({ ...f, fechaFallaConfirmada: f.fechaFallaConfirmada });
    fallasPorMaquina.set(f.maquinaId, list);
  }

  let totalSumaMinutos = 0;
  let totalValidos = 0;
  let totalInvalidos = 0;
  let maquinasContabilizadas = 0;
  const advertencias = new Set<string>();

  for (const mid of maquinasIds) {
    const list = fallasPorMaquina.get(mid) || [];
    if (list.length === 0) continue;

    // Ordenar por fechaFallaConfirmada ascendente
    const sorted = [...list].sort(
      (a, b) => a.fechaFallaConfirmada.getTime() - b.fechaFallaConfirmada.getTime()
    );

    let maquinasTieneValidos = false;
    let prev: FallaMTBFConfirmada | null = null;

    for (const current of sorted) {
      const currentConfirmTime = current.fechaFallaConfirmada.getTime();

      // El intervalo se calcula si la falla actual (siguiente) cae en el período
      if (currentConfirmTime < desde.getTime() || currentConfirmTime >= hastaEfectivo.getTime()) {
        prev = current;
        continue;
      }

      // Buscar la falla confirmada anterior
      if (prev) {
        if (prev.estado === "ABIERTA" || !prev.fechaRestauracion) {
          // No hay restauración anterior todavía, no se puede calcular un intervalo
          totalInvalidos++;
          continue;
        }

        const prevRestTime = prev.fechaRestauracion.getTime();

        // Si hay solapamiento (la anterior se restauró después de que inició la actual)
        if (prevRestTime > currentConfirmTime) {
          totalInvalidos++;
          advertencias.add("INTERVALOS_MTBF_SUPERPUESTOS");
          continue;
        }

        const diffMins = (currentConfirmTime - prevRestTime) / 60000;

        if (diffMins <= 0) {
          totalInvalidos++;
          continue;
        }

        totalSumaMinutos += diffMins;
        totalValidos++;
        maquinasTieneValidos = true;
      }

      prev = current;
    }

    if (maquinasTieneValidos) {
      maquinasContabilizadas++;
    }
  }

  let valorMinutos: number | null = null;
  let valorDias: number | null = null;
  let estado: MTBFResult["estado"] = "SIN_DATOS";

  const totalFallasConfirmadasEnPeriodo = fallasMaquina.filter(f => {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) return false;
    const t = f.fechaFallaConfirmada.getTime();
    return t >= desde.getTime() && t < hastaEfectivo.getTime();
  }).length;

  if (totalFallasConfirmadasEnPeriodo === 0) {
    estado = "SIN_DATOS";
  } else if (totalValidos === 0) {
    estado = "MUESTRA_INSUFICIENTE";
    advertencias.add("INTERVALOS_MTBF_INSUFICIENTES");
  } else {
    valorMinutos = totalSumaMinutos / totalValidos;
    valorDias = valorMinutos / 1440;
    estado = "CALCULABLE";
  }

  return {
    valorDias,
    valorMinutos,
    sumaMinutosIntervalos: totalSumaMinutos,
    intervalosValidos: totalValidos,
    intervalosInvalidos: totalInvalidos,
    maquinasConIntervalos: maquinasContabilizadas,
    estado,
    advertencias: Array.from(advertencias),
  };
}
