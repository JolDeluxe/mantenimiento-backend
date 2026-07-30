import { EstadoTarea, Estatus, Prisma, TipoAjusteRecurrencia } from "@prisma/client";
import { prisma } from "../../db";
import {
  fechaEfectivaMexico,
  fechaHoraMexico,
  formatearFechaLogica,
  horaDesdeMinutos,
  normalizarFechaLogica,
} from "../../utils/recurrencia-temporal";
import type { ReglaActividadConRelaciones } from "./types";

export class ActividadRecurrenteError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export const estadosMovibles = new Set<EstadoTarea>([EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA]);

export function dtoReglaActividad(regla: ReglaActividadConRelaciones) {
  return {
    ...regla,
    fechaInicio: formatearFechaLogica(regla.fechaInicio),
    fechaFin: regla.fechaFin ? formatearFechaLogica(regla.fechaFin) : null,
    proximaFechaEjecucion: formatearFechaLogica(regla.proximaFechaEjecucion),
    horaInicio: regla.horaInicioMinutos == null ? null : horaDesdeMinutos(regla.horaInicioMinutos),
    horaFin: regla.horaFinMinutos == null ? null : horaDesdeMinutos(regla.horaFinMinutos),
  };
}

export function resolverAjuste(
  fechaOriginal: Date,
  ajuste: { tipo: TipoAjusteRecurrencia; fechaNueva: Date | null; motivo: string | null } | null,
) {
  const original = normalizarFechaLogica(fechaOriginal);
  if (!ajuste) {
    return { fechaOriginal: original, fechaProgramada: original, omitida: false, movida: false, motivo: null, tipo: null };
  }
  if (ajuste.tipo === TipoAjusteRecurrencia.OMITIR) {
    return { fechaOriginal: original, fechaProgramada: original, omitida: true, movida: false, motivo: ajuste.motivo, tipo: ajuste.tipo };
  }
  const fechaProgramada = normalizarFechaLogica(ajuste.fechaNueva ?? original);
  return { fechaOriginal: original, fechaProgramada, omitida: false, movida: true, motivo: ajuste.motivo, tipo: ajuste.tipo };
}

export function programacionTarea(fechaEfectiva: Date, regla: Pick<ReglaActividadConRelaciones, "horaInicioMinutos" | "horaFinMinutos">) {
  const fechaVencimiento = fechaEfectivaMexico(fechaEfectiva);
  if (regla.horaInicioMinutos == null || regla.horaFinMinutos == null) {
    return { fechaVencimiento, horaInicioProgramada: null, horaFinProgramada: null };
  }
  return {
    fechaVencimiento,
    horaInicioProgramada: fechaHoraMexico(fechaEfectiva, regla.horaInicioMinutos),
    horaFinProgramada: fechaHoraMexico(fechaEfectiva, regla.horaFinMinutos),
  };
}

export async function validarResponsablesActivos(ids: number[]) {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return [];
  const users = await prisma.usuario.findMany({
    where: { id: { in: uniqueIds }, estado: Estatus.ACTIVO },
    select: { id: true },
  });
  if (users.length !== uniqueIds.length) {
    throw new ActividadRecurrenteError("Uno o más responsables no existen o están inactivos");
  }
  return uniqueIds;
}

export function isP2002(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
