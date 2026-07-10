// src/modules/recurrencias/helper.ts
//
// Helper de fechas para mantenimientos recurrentes.
// PRINCIPIO: fechaCicloLogica es la fecha ANCLA pura del ciclo.
//             No se ajusta por fines de semana ni feriados.
//             El ajuste físico solo ocurre al generar fechaVencimiento/horaInicioProgramada.

import { FrecuenciaRecurrencia } from "@prisma/client";

// ---------------------------------------------------------------------------
// 1. NORMALIZACIÓN: asegurar que la fecha lógica sea medianoche UTC
// ---------------------------------------------------------------------------

/**
 * Normaliza una fecha a medianoche UTC (00:00:00.000Z).
 * Esto garantiza que comparaciones de fechaCicloLogica sean exactas
 * independientemente del timezone del servidor o del cliente.
 */
export function normalizarFechaLogica(fecha: Date | string): Date {
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function inicioMesUTC(fecha: Date | string): Date {
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function finDeMesUTC(fecha: Date | string): Date {
  const d = new Date(fecha);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

export function mismoPeriodoMes(fechaA: Date | string | null | undefined, fechaB: Date | string | null | undefined): boolean {
  if (!fechaA || !fechaB) return false;
  const a = new Date(fechaA);
  const b = new Date(fechaB);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
}

// ---------------------------------------------------------------------------
// 2. CÁLCULO DE SIGUIENTE FECHA LÓGICA (sin drift)
// ---------------------------------------------------------------------------

/**
 * Calcula la siguiente fechaCicloLogica a partir de la fecha ancla actual.
 * NUNCA usa "hoy" como base — siempre parte de la fecha lógica del ciclo anterior
 * para evitar drift acumulativo.
 *
 * @param fechaActual  – La fechaCicloLogica del ciclo anterior (ya normalizada a UTC 00:00)
 * @param frecuencia   – Frecuencia de la regla
 * @param intervaloDias – Solo para PERSONALIZADA_DIAS
 */
export function calcularSiguienteFechaLogica(
  fechaActual: Date,
  frecuencia: FrecuenciaRecurrencia,
  intervaloDias?: number | null,
): Date {
  const base = normalizarFechaLogica(fechaActual);

  switch (frecuencia) {
    case FrecuenciaRecurrencia.SEMANAL:
      return addDaysUTC(base, 7);

    case FrecuenciaRecurrencia.QUINCENAL:
      return addDaysUTC(base, 14);

    case FrecuenciaRecurrencia.MENSUAL:
      // Suma un mes calendar preservando el día del mes original.
      // Si el mes destino no tiene ese día (ej. 31 → febrero), se ajusta
      // al último día válido del mes destino (clamp), sin saltarse al mes siguiente.
      return addMonthUTC(base, 1);

    case FrecuenciaRecurrencia.PERSONALIZADA_DIAS: {
      const dias = intervaloDias ?? 7;
      if (dias <= 0) throw new Error("intervaloDias debe ser mayor a 0");
      return addDaysUTC(base, dias);
    }

    default:
      throw new Error(`Frecuencia no reconocida: ${frecuencia}`);
  }
}

// ---------------------------------------------------------------------------
// 3. AJUSTE FÍSICO POR FIN DE SEMANA
// ---------------------------------------------------------------------------

/**
 * Ajusta una fecha lógica para evitar fines de semana.
 * Solo se usa para calcular fechaVencimiento/horaInicioProgramada — NUNCA para fechaCicloLogica.
 *
 * Regla: si la fecha cae en Sábado (6) → mueve al Lunes siguiente (+2).
 *        si cae en Domingo (0) → mueve al Lunes siguiente (+1).
 *        si es Lunes a Viernes → sin cambio.
 */
export function ajustarPorFinDeSemana(fecha: Date): Date {
  const d = new Date(fecha);
  const dow = d.getUTCDay(); // 0=Dom, 6=Sab
  if (dow === 6) return addDaysUTC(d, 2); // Sab → Lun
  if (dow === 0) return addDaysUTC(d, 1); // Dom → Lun
  return d;
}

// ---------------------------------------------------------------------------
// 4. GENERACIÓN DE PROYECCIONES POR AÑO
// ---------------------------------------------------------------------------

/**
 * Dado el estado actual de una ReglaRecurrencia, genera todas las
 * fechas lógicas de ciclos proyectados para el año especificado.
 *
 * - El anchor de inicio es la próximaFechaEjecucion de la regla
 *   (que representa la primera fecha lógica pendiente).
 * - Retrocede desde el anchor para cubrir ciclos que caigan en el año
 *   aunque el anchor esté en el futuro.
 * - Incluye hasta 3 años de proyección hacia adelante para que la vista
 *   anual siempre tenga datos suficientes.
 *
 * @param proximaFechaEjecucion – La fecha lógica base desde la que proyectar
 * @param frecuencia
 * @param intervaloDias
 * @param year – Año a proyectar (ej. 2026)
 * @param maxCiclos – Límite de seguridad (default 200)
 */
export function generarProyeccionesPorAno(
  proximaFechaEjecucion: Date,
  frecuencia: FrecuenciaRecurrencia,
  intervaloDias: number | null | undefined,
  year: number,
  maxCiclos = 200,
): Date[] {
  const inicioAno = new Date(Date.UTC(year, 0, 1));
  const finAno    = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

  const proyecciones: Date[] = [];
  let cursor = normalizarFechaLogica(proximaFechaEjecucion);
  let iteraciones = 0;

  // Retroceder el cursor hasta el inicio del año para capturar ciclos anteriores
  // que siguen proyectándose dentro del año de interés.
  // Limitamos la retrocesión a 5 años hacia atrás como guardia.
  const limite5AnosAtras = new Date(Date.UTC(year - 5, 0, 1));
  while (cursor > inicioAno && cursor > limite5AnosAtras) {
    const prev = retrocederUnCiclo(cursor, frecuencia, intervaloDias);
    if (prev >= cursor) break; // Guardia contra loop infinito
    cursor = prev;
  }

  // Avanzar generando fechas en el año objetivo
  while (cursor <= finAno && iteraciones < maxCiclos) {
    iteraciones++;
    if (cursor >= inicioAno && cursor <= finAno) {
      proyecciones.push(new Date(cursor));
    }
    const next = calcularSiguienteFechaLogica(cursor, frecuencia, intervaloDias);
    if (next <= cursor) break; // Guardia contra loop infinito
    cursor = next;
    if (cursor.getUTCFullYear() > year + 1) break; // No proyectar más de 1 año extra
  }

  return proyecciones;
}

// ---------------------------------------------------------------------------
// UTILIDADES PRIVADAS
// ---------------------------------------------------------------------------

function addDaysUTC(fecha: Date, dias: number): Date {
  const d = new Date(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/** Suma N meses con clamp al último día del mes destino (evita overflow) */
function addMonthUTC(fecha: Date, meses: number): Date {
  const year  = fecha.getUTCFullYear();
  const month = fecha.getUTCMonth() + meses;
  const day   = fecha.getUTCDate();

  // Obtener último día del mes destino
  const ultimoDia = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const diaFinal  = Math.min(day, ultimoDia);

  return new Date(Date.UTC(year, month, diaFinal));
}

/**
 * Retrocede un ciclo (inverso de calcularSiguienteFechaLogica).
 * Solo para calibrar el inicio de la proyección anual.
 */
function retrocederUnCiclo(
  fecha: Date,
  frecuencia: FrecuenciaRecurrencia,
  intervaloDias?: number | null,
): Date {
  switch (frecuencia) {
    case FrecuenciaRecurrencia.SEMANAL:
      return addDaysUTC(fecha, -7);
    case FrecuenciaRecurrencia.QUINCENAL:
      return addDaysUTC(fecha, -14);
    case FrecuenciaRecurrencia.MENSUAL:
      return addMonthUTC(fecha, -1);
    case FrecuenciaRecurrencia.PERSONALIZADA_DIAS:
      return addDaysUTC(fecha, -(intervaloDias ?? 7));
    default:
      return addDaysUTC(fecha, -30);
  }
}

/** Formatea una fecha UTC como string seguro YYYY-MM-DD */
export function formatearFechaUTC(fecha: Date): string {
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
