/**
 * bi_maquinaria/calculations/periodos.ts
 *
 * Funciones puras para el cálculo y validación de periodos temporales
 * en la zona horaria America/Mexico_City.
 */

// Regex para asegurar offset o zona horaria explícita (e.g. Z, +02:00, -06:00, etc.)
// No permite la ausencia de offset (ej: 2026-08-01T00:00:00)
export const ISO_WITH_OFFSET_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

export interface PeriodoInput {
  desdeStr: string;
  hastaStr: string;
  ahora: Date;
}

export interface PeriodoEfectivo {
  desde: Date;
  hasta: Date;
  hastaEfectivo: Date;
  periodoRecortadoAHoy: boolean;
}

export function validarYCalcularPeriodo(input: PeriodoInput): PeriodoEfectivo {
  const { desdeStr, hastaStr, ahora } = input;

  if (!ISO_WITH_OFFSET_REGEX.test(desdeStr)) {
    throw new Error("El parámetro 'desde' debe ser una fecha ISO 8601 con zona horaria o desplazamiento offset explícito (ej: 2026-08-01T00:00:00-06:00).");
  }
  if (!ISO_WITH_OFFSET_REGEX.test(hastaStr)) {
    throw new Error("El parámetro 'hasta' debe ser una fecha ISO 8601 con zona horaria o desplazamiento offset explícito (ej: 2026-08-01T00:00:00-06:00).");
  }

  const desde = new Date(desdeStr);
  const hasta = new Date(hastaStr);

  if (isNaN(desde.getTime()) || isNaN(hasta.getTime())) {
    throw new Error("Fechas inválidas provistas.");
  }

  if (desde >= hasta) {
    throw new Error("La fecha 'desde' debe ser estrictamente menor que la fecha 'hasta'.");
  }

  if (desde.getTime() > ahora.getTime()) {
    throw new Error("El periodo solicitado no puede iniciar en el futuro.");
  }

  let hastaEfectivo = hasta;
  let periodoRecortadoAHoy = false;

  if (hasta.getTime() > ahora.getTime()) {
    hastaEfectivo = ahora;
    periodoRecortadoAHoy = true;
  }

  if (hastaEfectivo.getTime() <= desde.getTime()) {
    throw new Error("El periodo efectivo debe tener duración positiva y no puede estar completamente en el futuro.");
  }

  return {
    desde,
    hasta,
    hastaEfectivo,
    periodoRecortadoAHoy,
  };
}

export interface MachineObservedTimeInput {
  maquinaCreatedAt: Date;
  desde: Date;
  hastaEfectivo: Date;
}

export function calcularMinutosObservadosMaquina(input: MachineObservedTimeInput): number {
  const { maquinaCreatedAt, desde, hastaEfectivo } = input;

  if (maquinaCreatedAt.getTime() >= hastaEfectivo.getTime()) {
    return 0;
  }

  const inicioObservacion = maquinaCreatedAt.getTime() > desde.getTime()
    ? maquinaCreatedAt
    : desde;

  const finObservacion = hastaEfectivo;

  const diffMs = finObservacion.getTime() - inicioObservacion.getTime();
  return Math.max(0, diffMs / 60000);
}

const MX_TIME_ZONE = "America/Mexico_City";
const MX_OFFSET = "-06:00";

const mxDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MX_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const mxTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MX_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function getMXDateKey(date: Date): string {
  const parts = Object.fromEntries(
    mxDateFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isMXMidnight(date: Date): boolean {
  const parts = Object.fromEntries(
    mxTimeFormatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return hour === "00" && parts.minute === "00" && parts.second === "00";
}

function addDaysToDateKey(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getMXDayOfWeek(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00${MX_OFFSET}`).getUTCDay();
}

function getNextMXDayStart(date: Date): Date {
  const todayKey = getMXDateKey(date);
  return new Date(`${addDaysToDateKey(todayKey, 1)}T00:00:00${MX_OFFSET}`);
}

function getProgrammedEndExclusive(hastaSolicitado: Date, ahora: Date): Date {
  if (hastaSolicitado.getTime() <= ahora.getTime()) {
    return hastaSolicitado;
  }

  const nextTodayStart = getNextMXDayStart(ahora);
  return hastaSolicitado.getTime() < nextTodayStart.getTime()
    ? hastaSolicitado
    : nextTodayStart;
}

function getEndDateKeyExclusive(endExclusive: Date): string {
  const key = getMXDateKey(endExclusive);
  return isMXMidnight(endExclusive) ? key : addDaysToDateKey(key, 1);
}

export interface MachineProgrammedTimeInput {
  maquinaCreatedAt: Date;
  desde: Date;
  hastaSolicitado: Date;
  ahora: Date;
  domingosConActividad?: Set<string>;
}

export function calcularMinutosProgramadosMaquina(input: MachineProgrammedTimeInput): number {
  const { desde, hastaSolicitado, ahora, domingosConActividad = new Set() } = input;
  const hastaProgramado = getProgrammedEndExclusive(hastaSolicitado, ahora);

  let currentKey = getMXDateKey(desde);
  const endKey = getEndDateKeyExclusive(hastaProgramado);
  let total = 0;

  while (currentKey < endKey) {
    const dayOfWeek = getMXDayOfWeek(currentKey);

    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      total += 540;
    } else if (dayOfWeek === 6) {
      total += 360;
    } else if (domingosConActividad.has(currentKey)) {
      total += 360;
    }

    currentKey = addDaysToDateKey(currentKey, 1);
  }

  return total;
}

export interface ActividadProgramacionInput {
  maquinaId: number;
  inicio: Date;
  fin?: Date | null;
}

export function calcularDomingosConActividadPorMaquina(
  actividades: ActividadProgramacionInput[],
  desde: Date,
  hastaSolicitado: Date,
  ahora: Date,
): Map<number, Set<string>> {
  const hastaProgramado = getProgrammedEndExclusive(hastaSolicitado, ahora);
  const result = new Map<number, Set<string>>();

  for (const actividad of actividades) {
    const inicioMs = Math.max(actividad.inicio.getTime(), desde.getTime());
    const finBase = actividad.fin ?? actividad.inicio;
    const finMs = Math.min(finBase.getTime(), hastaProgramado.getTime());
    if (actividad.inicio.getTime() >= hastaProgramado.getTime() || finBase.getTime() < desde.getTime()) {
      continue;
    }

    let currentKey = getMXDateKey(new Date(inicioMs));
    const endKey = finMs > inicioMs
      ? getEndDateKeyExclusive(new Date(finMs))
      : addDaysToDateKey(currentKey, 1);

    while (currentKey < endKey) {
      if (getMXDayOfWeek(currentKey) === 0) {
        const domingos = result.get(actividad.maquinaId) ?? new Set<string>();
        domingos.add(currentKey);
        result.set(actividad.maquinaId, domingos);
      }
      currentKey = addDaysToDateKey(currentKey, 1);
    }
  }

  return result;
}
