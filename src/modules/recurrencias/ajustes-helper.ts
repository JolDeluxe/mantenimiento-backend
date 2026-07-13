import { TipoAjusteRecurrencia, type ReglaRecurrenciaAjuste } from "@prisma/client";
import { prisma } from "../../db";
import { formatearFechaUTC, normalizarFechaLogica } from "./helper";

export type AjusteRecurrenciaResultado = {
  fechaOriginal: Date;
  fechaProgramada: Date;
  fechaProgramadaPreventiva: Date | null;
  omitida: boolean;
  ajuste: ReglaRecurrenciaAjuste | null;
  estadoAjuste: TipoAjusteRecurrencia | null;
  motivo: string | null;
  movida: boolean;
  movidaDesde: string | null;
  movidaA: string | null;
};

export const normalizarFechaOriginalUTC = (fecha: Date | string): Date => normalizarFechaLogica(fecha);

export const obtenerPeriodoDesdeFecha = (fecha: Date | string) => {
  const d = normalizarFechaOriginalUTC(fecha);
  return {
    periodoAnio: d.getUTCFullYear(),
    periodoMes: d.getUTCMonth() + 1,
  };
};

export const mismoDiaUTC = (fechaA: Date | string | null | undefined, fechaB: Date | string | null | undefined): boolean => {
  if (!fechaA || !fechaB) return false;
  return normalizarFechaOriginalUTC(fechaA).getTime() === normalizarFechaOriginalUTC(fechaB).getTime();
};

export async function obtenerAjustesActivosPorRegla(reglaIds: number[], inicio: Date, fin: Date) {
  if (reglaIds.length === 0) return new Map<string, ReglaRecurrenciaAjuste>();

  const ajustes = await prisma.reglaRecurrenciaAjuste.findMany({
    where: {
      reglaRecurrenciaId: { in: reglaIds },
      fechaOriginal: { gte: inicio, lte: fin },
      activo: true,
    },
  });

  return new Map(ajustes.map((ajuste) => [keyAjuste(ajuste.reglaRecurrenciaId, ajuste.fechaOriginal), ajuste]));
}

export const keyAjuste = (reglaId: number, fechaOriginal: Date) =>
  `${reglaId}|${normalizarFechaOriginalUTC(fechaOriginal).toISOString()}`;

export async function resolverOcurrenciaConAjuste(reglaId: number, fechaOriginalRaw: Date | string): Promise<AjusteRecurrenciaResultado> {
  const fechaOriginal = normalizarFechaOriginalUTC(fechaOriginalRaw);
  const ajuste = await prisma.reglaRecurrenciaAjuste.findUnique({
    where: {
      reglaRecurrenciaId_fechaOriginal: {
        reglaRecurrenciaId: reglaId,
        fechaOriginal,
      },
    },
  });

  return resolverOcurrenciaDesdeAjuste(fechaOriginal, ajuste?.activo ? ajuste : null);
}

export function resolverOcurrenciaDesdeAjuste(fechaOriginalRaw: Date | string, ajuste: ReglaRecurrenciaAjuste | null): AjusteRecurrenciaResultado {
  const fechaOriginal = normalizarFechaOriginalUTC(fechaOriginalRaw);

  if (!ajuste) {
    return {
      fechaOriginal,
      fechaProgramada: fechaOriginal,
      fechaProgramadaPreventiva: null,
      omitida: false,
      ajuste: null,
      estadoAjuste: null,
      motivo: null,
      movida: false,
      movidaDesde: null,
      movidaA: null,
    };
  }

  if (ajuste.tipo === TipoAjusteRecurrencia.OMITIR) {
    return {
      fechaOriginal,
      fechaProgramada: fechaOriginal,
      fechaProgramadaPreventiva: null,
      omitida: true,
      ajuste,
      estadoAjuste: ajuste.tipo,
      motivo: ajuste.motivo,
      movida: false,
      movidaDesde: null,
      movidaA: null,
    };
  }

  const fechaNueva = ajuste.fechaNueva ? normalizarFechaOriginalUTC(ajuste.fechaNueva) : fechaOriginal;
  return {
    fechaOriginal,
    fechaProgramada: fechaNueva,
    fechaProgramadaPreventiva: fechaNueva,
    omitida: false,
    ajuste,
    estadoAjuste: ajuste.tipo,
    motivo: ajuste.motivo,
    movida: true,
    movidaDesde: formatearFechaUTC(fechaOriginal),
    movidaA: formatearFechaUTC(fechaNueva),
  };
}

