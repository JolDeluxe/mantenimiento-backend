import type { UnidadRecurrenciaActividad } from "@prisma/client";
import { normalizarFechaLogica, siguienteCicloOperativo } from "../../utils/recurrencia-temporal";

export type ReglaActividadPolitica = {
  fechaInicio: Date;
  fechaFin: Date | null;
  unidad: UnidadRecurrenciaActividad;
  intervalo: number;
  proximaFechaEjecucion: Date;
};

export type DecisionMaterializacionActividad = {
  fechaCicloLogica: Date | null;
  proximaFechaEjecucion: Date;
  ciclosDescartados: number;
  requiereActualizarCursor: boolean;
  motivo: "FUTURA" | "HOY_NO_TOCA" | "MATERIALIZAR_HOY" | "MATERIALIZAR_DEUDA" | "FUERA_DE_VIGENCIA";
};

export function resolverPoliticaMaterializacionActividad(
  regla: ReglaActividadPolitica,
  hoyRaw: Date | string,
): DecisionMaterializacionActividad {
  const hoy = normalizarFechaLogica(hoyRaw);
  const proximaOriginal = normalizarFechaLogica(regla.proximaFechaEjecucion);
  const fechaFin = regla.fechaFin ? normalizarFechaLogica(regla.fechaFin) : null;
  const patron = {
    fechaInicio: regla.fechaInicio,
    fechaFin: regla.fechaFin,
    unidad: regla.unidad,
    intervalo: regla.intervalo,
  };

  if (proximaOriginal > hoy) {
    return {
      fechaCicloLogica: null,
      proximaFechaEjecucion: proximaOriginal,
      ciclosDescartados: 0,
      requiereActualizarCursor: false,
      motivo: "FUTURA",
    };
  }

  let cursor = proximaOriginal;
  let candidata: Date | null = null;
  let ciclosDescartados = 0;
  let guard = 0;
  const esDiaria = regla.unidad === "DIA";

  while (cursor <= hoy && guard < 1000) {
    const dentroDeVigencia = !fechaFin || cursor <= fechaFin;
    if (esDiaria) {
      if (cursor.getTime() === hoy.getTime() && dentroDeVigencia) {
        candidata = cursor;
      } else {
        ciclosDescartados++;
      }
    } else if (dentroDeVigencia) {
      if (candidata) ciclosDescartados++;
      candidata = cursor;
    } else {
      ciclosDescartados++;
    }
    cursor = siguienteCicloOperativo({ ...patron, fechaFin: null }, cursor);
    guard++;
  }

  if (guard >= 1000) {
    throw new Error("Límite de seguridad al avanzar actividad recurrente atrasada");
  }

  if (!candidata && fechaFin && proximaOriginal > fechaFin) {
    return {
      fechaCicloLogica: null,
      proximaFechaEjecucion: cursor,
      ciclosDescartados,
      requiereActualizarCursor: cursor.getTime() !== proximaOriginal.getTime(),
      motivo: "FUERA_DE_VIGENCIA",
    };
  }

  if (candidata) {
    return {
      fechaCicloLogica: candidata,
      proximaFechaEjecucion: cursor,
      ciclosDescartados,
      requiereActualizarCursor: cursor.getTime() !== proximaOriginal.getTime(),
      motivo: candidata.getTime() === hoy.getTime() ? "MATERIALIZAR_HOY" : "MATERIALIZAR_DEUDA",
    };
  }

  return {
    fechaCicloLogica: null,
    proximaFechaEjecucion: cursor,
    ciclosDescartados,
    requiereActualizarCursor: cursor.getTime() !== proximaOriginal.getTime(),
    motivo: "HOY_NO_TOCA",
  };
}
