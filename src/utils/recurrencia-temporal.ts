import { UnidadRecurrenciaActividad } from "@prisma/client";

export const ZONA_HORARIA_MX = "America/Mexico_City";
const MS_DIA = 24 * 60 * 60 * 1000;

export type PatronActividadRecurrente = {
  fechaInicio: Date;
  fechaFin?: Date | null;
  unidad: UnidadRecurrenciaActividad;
  intervalo: number;
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{2}):(\d{2})$/;

export function normalizarFechaLogica(fecha: Date | string): Date {
  if (typeof fecha === "string") {
    const match = DATE_ONLY.exec(fecha);
    if (match) {
      const [, year, month, day] = match;
      const result = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        result.getUTCFullYear() !== Number(year) ||
        result.getUTCMonth() !== Number(month) - 1 ||
        result.getUTCDate() !== Number(day)
      ) {
        throw new Error("Fecha calendario inválida");
      }
      return result;
    }
  }

  const value = new Date(fecha);
  if (Number.isNaN(value.getTime())) throw new Error("Fecha inválida");
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function formatearFechaLogica(fecha: Date | string): string {
  const value = normalizarFechaLogica(fecha);
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function sumarDias(fecha: Date, dias: number): Date {
  const result = normalizarFechaLogica(fecha);
  result.setUTCDate(result.getUTCDate() + dias);
  return result;
}

export function sumarMesesDesdeAncla(fechaInicio: Date, meses: number): Date {
  const anchor = normalizarFechaLogica(fechaInicio);
  const targetMonth = anchor.getUTCMonth() + meses;
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anchor.getUTCFullYear(), targetMonth, Math.min(anchor.getUTCDate(), lastDay)));
}

export function fechaEstaEnRango(patron: PatronActividadRecurrente, fecha: Date | string): boolean {
  const cycle = normalizarFechaLogica(fecha);
  const start = normalizarFechaLogica(patron.fechaInicio);
  if (cycle < start) return false;
  return !patron.fechaFin || cycle <= normalizarFechaLogica(patron.fechaFin);
}

export function esDomingo(fecha: Date | string): boolean {
  return normalizarFechaLogica(fecha).getUTCDay() === 0;
}

export function esCicloDelPatron(patron: PatronActividadRecurrente, fecha: Date | string): boolean {
  if (!Number.isInteger(patron.intervalo) || patron.intervalo <= 0 || !fechaEstaEnRango(patron, fecha)) {
    return false;
  }

  const cycle = normalizarFechaLogica(fecha);
  const start = normalizarFechaLogica(patron.fechaInicio);
  const days = Math.round((cycle.getTime() - start.getTime()) / MS_DIA);

  if (patron.unidad === UnidadRecurrenciaActividad.DIA) return days % patron.intervalo === 0;
  if (patron.unidad === UnidadRecurrenciaActividad.SEMANA) return days % (patron.intervalo * 7) === 0;

  const months = (cycle.getUTCFullYear() - start.getUTCFullYear()) * 12 + cycle.getUTCMonth() - start.getUTCMonth();
  if (months < 0 || months % patron.intervalo !== 0) return false;
  return sumarMesesDesdeAncla(start, months).getTime() === cycle.getTime();
}

export function siguienteCiclo(patron: PatronActividadRecurrente, cicloActual: Date): Date {
  const current = normalizarFechaLogica(cicloActual);
  if (!esCicloDelPatron({ ...patron, fechaFin: null }, current)) {
    throw new Error("El ciclo actual no pertenece al patrón de recurrencia");
  }

  if (patron.unidad === UnidadRecurrenciaActividad.DIA) return sumarDias(current, patron.intervalo);
  if (patron.unidad === UnidadRecurrenciaActividad.SEMANA) return sumarDias(current, patron.intervalo * 7);

  const start = normalizarFechaLogica(patron.fechaInicio);
  const currentMonths = (current.getUTCFullYear() - start.getUTCFullYear()) * 12 + current.getUTCMonth() - start.getUTCMonth();
  return sumarMesesDesdeAncla(start, currentMonths + patron.intervalo);
}

export function esCicloOperativoDelPatron(patron: PatronActividadRecurrente, fecha: Date | string): boolean {
  return !esDomingo(fecha) && esCicloDelPatron(patron, fecha);
}

export function siguienteCicloOperativo(patron: PatronActividadRecurrente, cicloActual: Date, maxSaltos = 370): Date {
  let cursor = siguienteCiclo(patron, cicloActual);
  let guard = 0;
  while (esDomingo(cursor)) {
    cursor = siguienteCiclo(patron, cursor);
    if (++guard > maxSaltos) throw new Error("No existe un próximo ciclo operativo sin domingo para este patrón");
  }
  return cursor;
}

export function generarCiclosEnRango(patron: PatronActividadRecurrente, desde: Date, hasta: Date, maxCiclos = 1000): Date[] {
  const start = normalizarFechaLogica(patron.fechaInicio);
  const rangeStart = normalizarFechaLogica(desde);
  const rangeEnd = normalizarFechaLogica(hasta);
  const end = patron.fechaFin && normalizarFechaLogica(patron.fechaFin) < rangeEnd
    ? normalizarFechaLogica(patron.fechaFin)
    : rangeEnd;
  if (end < start || end < rangeStart) return [];

  const cycles: Date[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor < rangeStart) {
    cursor = siguienteCiclo({ ...patron, fechaFin: null }, cursor);
    if (++guard > maxCiclos * 10) throw new Error("Límite de seguridad al buscar ciclos");
  }

  while (cursor <= end) {
    cycles.push(cursor);
    if (cycles.length > maxCiclos) throw new Error("El rango excede el máximo de ciclos permitido");
    cursor = siguienteCiclo({ ...patron, fechaFin: null }, cursor);
  }
  return cycles;
}

export function generarCiclosOperativosEnRango(patron: PatronActividadRecurrente, desde: Date, hasta: Date, maxCiclos = 1000): Date[] {
  return generarCiclosEnRango(patron, desde, hasta, maxCiclos).filter((cycle) => !esDomingo(cycle));
}

export function minutosDesdeHora(valor: string): number {
  const match = TIME_ONLY.exec(valor);
  if (!match) throw new Error("La hora debe tener formato HH:mm");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error("Hora fuera de rango");
  return hours * 60 + minutes;
}

export function horaDesdeMinutos(minutos: number): string {
  if (!Number.isInteger(minutos) || minutos < 0 || minutos > 1439) throw new Error("Minutos fuera de rango");
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

function getOffsetMexico(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA_MX,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return (Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant.getTime()) / 60000;
}

export function fechaHoraMexico(fecha: Date | string, minutos: number): Date {
  const day = normalizarFechaLogica(fecha);
  if (!Number.isInteger(minutos) || minutos < 0 || minutos > 1439) throw new Error("Minutos fuera de rango");
  const guess = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Math.floor(minutos / 60), minutos % 60));
  let result = new Date(guess.getTime() - getOffsetMexico(guess) * 60000);
  const correctedOffset = getOffsetMexico(result);
  if (correctedOffset !== getOffsetMexico(guess)) result = new Date(guess.getTime() - correctedOffset * 60000);
  return result;
}

export function fechaEfectivaMexico(fecha: Date | string): Date {
  return fechaHoraMexico(fecha, 0);
}
