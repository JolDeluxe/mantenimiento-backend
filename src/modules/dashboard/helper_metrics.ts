import { EstadoTarea } from "@prisma/client";

export const UMBRAL_DATOS_SUFICIENTES = 3;

/** Zona horaria corporativa — fuente única de verdad para comparaciones de día calendario. */
const TZ = 'America/Mexico_City';

/**
 * Normaliza una fecha a YYYY-MM-DD en la zona horaria de México.
 * Exportada para reutilización en 01_kpis_general y 04_tecnico_detalle.
 * Elimina por completo el desfase UTC vs horario local.
 */
export const toMXDateStr = (date: Date): string =>
  date.toLocaleDateString('en-CA', { timeZone: TZ });

export const calcularKpiTarea = (tarea: {
  estado: EstadoTarea;
  finalizadoAt: Date | null;
  fechaVencimiento: Date | null;
  duracionReal: number | null;
  tiempoEstimado: number | null;
  historial: { id: number }[];
}): number => {
  const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];

  if (!ESTADOS_TERMINADOS.includes(tarea.estado)) return 0;

  let kpiObtenido = 20;
  let kpiMaximo = 100;

  // 1. PUNTUALIDAD (40 pts)
  // Comparación YYYY-MM-DD en México. Una tarea finalizada el mismo día que vence = A TIEMPO.
  if (tarea.fechaVencimiento && tarea.finalizadoAt) {
    const dFin  = toMXDateStr(new Date(tarea.finalizadoAt));
    const dVenc = toMXDateStr(new Date(tarea.fechaVencimiento));
    if (dFin <= dVenc) kpiObtenido += 40;
  } else if (!tarea.fechaVencimiento) {
    kpiMaximo -= 40; // Sin fecha límite no se puede evaluar ni penalizar
  }

  // 2. EFICIENCIA DE TIEMPO (20 pts)
  if (tarea.tiempoEstimado && tarea.tiempoEstimado > 0) {
    const duracion = tarea.duracionReal ?? 0;
    if (duracion > 0 && duracion <= tarea.tiempoEstimado) kpiObtenido += 20;
  } else {
    kpiMaximo -= 20; // Sin estimado no se evalúa
  }

  // 3. CALIDAD A LA PRIMERA (20 pts)
  if (tarea.historial.length === 0) kpiObtenido += 20;

  if (kpiMaximo <= 0) return 100;
  return (kpiObtenido / kpiMaximo) * 100;
};

export const calcularKpiAgregado = (
  kpis: number[]
): { kpiPromedio: number; datosSuficientes: boolean } => {
  const datosSuficientes = kpis.length >= UMBRAL_DATOS_SUFICIENTES;
  if (kpis.length === 0) return { kpiPromedio: 0, datosSuficientes: false };
  const kpiPromedio = kpis.reduce((a, b) => a + b, 0) / kpis.length;
  return { kpiPromedio, datosSuficientes };
};

export const colorParaKpi = (kpi: number): "green" | "amber" | "red" => {
  if (kpi >= 80) return "green";
  if (kpi >= 50) return "amber";
  return "red";
};

export const buildDateRange = (
  year?: number,
  month?: number
): { fechaInicio?: Date; fechaFin?: Date } => {
  if (!year) return {};
  if (!month || month === 0) {
    return {
      fechaInicio: new Date(year, 0, 1, 0, 0, 0, 0),
      fechaFin:    new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }
  const lastDay = new Date(year, month, 0).getDate();
  return {
    fechaInicio: new Date(year, month - 1, 1, 0, 0, 0, 0),
    fechaFin:    new Date(year, month - 1, lastDay, 23, 59, 59, 999),
  };
};

export const buildDateRangeFromStrings = (
  fechaInicioStr?: string,
  fechaFinStr?: string
): { fechaInicio?: Date; fechaFin?: Date } => {
  if (!fechaInicioStr || !fechaFinStr) return {};
  const [y1 = 0, m1 = 1, d1 = 1] = fechaInicioStr.split('-').map(Number);
  const [y2 = 0, m2 = 1, d2 = 1] = fechaFinStr.split('-').map(Number);
  const fi = new Date(y1, m1 - 1, d1, 0, 0, 0, 0);
  const ff = new Date(y2, m2 - 1, d2, 23, 59, 59, 999);
  if (isNaN(fi.getTime()) || isNaN(ff.getTime())) return {};
  return { fechaInicio: fi, fechaFin: ff };
};

export const resolverRangoFechas = (
  year?: number,
  month?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): { fechaInicio?: Date; fechaFin?: Date } => {
  if (fechaInicioStr && fechaFinStr) return buildDateRangeFromStrings(fechaInicioStr, fechaFinStr);
  return buildDateRange(year, month);
};