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
