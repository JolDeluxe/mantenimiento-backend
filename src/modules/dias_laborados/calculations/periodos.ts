import { DIAS_LABORADOS_TIMEZONE } from "../constants";
import type { PeriodoDiasLaborados, PeriodoCalculado, GranularidadDiasLaborados } from "../types";

// Helper para formatear un objeto Date a string YYYY-MM-DD en la zona horaria local de México
export function fechaKeyMX(date: Date): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DIAS_LABORADOS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

// Devuelve el día de la semana local de México (0 = Domingo, 1 = Lunes, ..., 6 = Sábado)
export function diaSemanaLocal(date: Date): number {
  const formatterLong = new Intl.DateTimeFormat("en-US", {
    timeZone: DIAS_LABORADOS_TIMEZONE,
    weekday: "long",
  });
  const dayName = formatterLong.format(date);
  const mapping: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return mapping[dayName] ?? date.getDay();
}

// Devuelve el primer instante (inclusivo) de un día en base a un string YYYY-MM-DD (hora 00:00:00 local de México)
export function instanteInicioMX(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00-06:00`);
}

// Suma o resta días a una fecha clave YYYY-MM-DD
export function sumarDiasKey(dateStr: string, dias: number): string {
  const date = instanteInicioMX(dateStr);
  date.setDate(date.getDate() + dias);
  return fechaKeyMX(date);
}

// Enumera todas las fechas YYYY-MM-DD entre desde y hasta inclusivo
export function enumerarFechas(desdeStr: string, hastaStr: string): string[] {
  const fechas: string[] = [];
  let cursor = desdeStr;
  while (cursor <= hastaStr) {
    fechas.push(cursor);
    cursor = sumarDiasKey(cursor, 1);
  }
  return fechas;
}

// Obtiene información de la semana ISO y año para una fecha clave YYYY-MM-DD
export function getISOWeek(dateStr: string): { year: number; week: number } {
  const date = instanteInicioMX(dateStr);
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const week = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  return { year: target.getFullYear(), week };
}

function fechaKeyUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function lunesISODeSemana(anio: number, semana: number): string {
  const enero4 = new Date(Date.UTC(anio, 0, 4));
  const diaEnero4 = enero4.getUTCDay() || 7;
  const lunesSemana1 = new Date(enero4.getTime());
  lunesSemana1.setUTCDate(enero4.getUTCDate() - diaEnero4 + 1);

  const lunesObjetivo = new Date(lunesSemana1.getTime());
  lunesObjetivo.setUTCDate(lunesSemana1.getUTCDate() + (semana - 1) * 7);

  return fechaKeyUTC(lunesObjetivo);
}

export function calcularPeriodo(query: {
  periodo: PeriodoDiasLaborados;
  anio: number;
  semana?: number | null;
  mes?: number | null;
}): PeriodoCalculado {
  const { periodo, anio, semana, mes } = query;
  let desdeFecha = "";
  let hastaFecha = "";
  let granularidad: GranularidadDiasLaborados = "DIA";

  if (periodo === "SEMANA") {
    if (!semana) throw new Error("La semana es requerida para el periodo SEMANA");
    desdeFecha = lunesISODeSemana(anio, semana);
    hastaFecha = sumarDiasKey(desdeFecha, 6);
    granularidad = "DIA";
  } else if (periodo === "MES") {
    if (mes === undefined || mes === null) throw new Error("El mes es requerido para el periodo MES");
    const mesPad = String(mes).padStart(2, "0");
    desdeFecha = `${anio}-${mesPad}-01`;
    const ultDia = new Date(anio, mes, 0).getDate();
    hastaFecha = `${anio}-${mesPad}-${String(ultDia).padStart(2, "0")}`;
    granularidad = "DIA";
  } else if (periodo === "ANIO") {
    desdeFecha = `${anio}-01-01`;
    hastaFecha = `${anio}-12-31`;
    granularidad = "MES";
  } else {
    throw new Error(`Periodo inválido: ${periodo}`);
  }

  const desde = instanteInicioMX(desdeFecha);
  const hastaExclusivo = instanteInicioMX(sumarDiasKey(hastaFecha, 1));

  return {
    periodo,
    anio,
    semana: semana || null,
    mes: mes || null,
    desdeFecha,
    hastaFecha,
    desde,
    hastaExclusivo,
    granularidad,
  };
}
