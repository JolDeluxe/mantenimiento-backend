import { FrecuenciaRecurrencia } from "@prisma/client";
import { calcularSiguienteFechaLogica, normalizarFechaLogica } from "./helper";

export type ReglaRecurrenciaPolitica = {
  fechaInicio: Date;
  frecuencia: FrecuenciaRecurrencia;
  intervaloDias: number | null;
  proximaFechaEjecucion: Date;
};

export type DecisionMaterializacionRecurrencia = {
  fechaCicloLogica: Date | null;
  proximaFechaEjecucion: Date;
  ciclosDescartados: number;
  requiereActualizarCursor: boolean;
  motivo: "FUTURA" | "SIN_CICLO_VIGENTE" | "MATERIALIZAR_CICLO_VIGENTE";
};

export function esCicloProgramadoRecurrencia(
  regla: Pick<ReglaRecurrenciaPolitica, "fechaInicio" | "frecuencia" | "intervaloDias">,
  fechaRaw: Date | string,
): boolean {
  const fecha = normalizarFechaLogica(fechaRaw);
  let cursor = normalizarFechaLogica(regla.fechaInicio);
  let guard = 0;

  while (cursor < fecha && guard < 2000) {
    const siguiente = calcularSiguienteFechaLogica(cursor, regla.frecuencia, regla.intervaloDias, regla.fechaInicio);
    if (siguiente <= cursor) throw new Error("La recurrencia no avanza de forma válida");
    cursor = siguiente;
    guard++;
  }

  if (guard >= 2000) throw new Error("Límite de seguridad al validar ciclo preventivo");
  return cursor.getTime() === fecha.getTime();
}

export function resolverPoliticaMaterializacionRecurrencia(
  regla: ReglaRecurrenciaPolitica,
  hoyRaw: Date | string,
): DecisionMaterializacionRecurrencia {
  const hoy = normalizarFechaLogica(hoyRaw);
  const proximaOriginal = normalizarFechaLogica(regla.proximaFechaEjecucion);

  if (proximaOriginal > hoy) {
    return {
      fechaCicloLogica: null,
      proximaFechaEjecucion: proximaOriginal,
      ciclosDescartados: 0,
      requiereActualizarCursor: false,
      motivo: "FUTURA",
    };
  }

  const esDiaria = regla.frecuencia === FrecuenciaRecurrencia.PERSONALIZADA_DIAS && regla.intervaloDias === 1;
  let cursor = proximaOriginal;
  let candidata: Date | null = null;
  let ciclosDescartados = 0;
  let guard = 0;

  while (cursor <= hoy && guard < 2000) {
    if (esDiaria) {
      if (cursor.getTime() === hoy.getTime()) {
        candidata = cursor;
      } else {
        ciclosDescartados++;
      }
    } else {
      if (candidata) ciclosDescartados++;
      candidata = cursor;
    }

    const siguiente = calcularSiguienteFechaLogica(cursor, regla.frecuencia, regla.intervaloDias, regla.fechaInicio);
    if (siguiente <= cursor) throw new Error("La recurrencia no avanza de forma válida");
    cursor = siguiente;
    guard++;
  }

  if (guard >= 2000) {
    throw new Error("Límite de seguridad al avanzar recurrencia preventiva atrasada");
  }

  if (!candidata) {
    return {
      fechaCicloLogica: null,
      proximaFechaEjecucion: cursor,
      ciclosDescartados,
      requiereActualizarCursor: cursor.getTime() !== proximaOriginal.getTime(),
      motivo: "SIN_CICLO_VIGENTE",
    };
  }

  return {
    fechaCicloLogica: candidata,
    proximaFechaEjecucion: cursor,
    ciclosDescartados,
    requiereActualizarCursor: true,
    motivo: "MATERIALIZAR_CICLO_VIGENTE",
  };
}
