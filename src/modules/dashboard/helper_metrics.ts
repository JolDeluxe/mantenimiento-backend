// src/modules/dashboard/helper_metrics.ts
import { EstadoTarea } from "@prisma/client";

export const UMBRAL_DATOS_SUFICIENTES = 3;

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

  let kpi = 20; 

  if (tarea.finalizadoAt && tarea.fechaVencimiento) {
    if (tarea.finalizadoAt <= tarea.fechaVencimiento) kpi += 40;
  }

  const duracion = tarea.duracionReal ?? 0;
  if (duracion > 0 && tarea.tiempoEstimado && tarea.tiempoEstimado > 0 && duracion <= tarea.tiempoEstimado) {
    kpi += 20;
  }

  if (tarea.historial.length === 0) {
    kpi += 20;
  }

  return kpi;
};

export const calcularKpiAgregado = (
  kpis: number[]
): { kpiPromedio: number; datosSuficientes: boolean } => {
  const datosSuficientes = kpis.length >= UMBRAL_DATOS_SUFICIENTES;
  if (kpis.length === 0) return { kpiPromedio: 0, datosSuficientes: false };
  const kpiPromedio = Math.round(kpis.reduce((a, b) => a + b, 0) / kpis.length);
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

  const fi = new Date(fechaInicioStr);
  const ff = new Date(fechaFinStr);

  fi.setHours(0, 0, 0, 0);
  ff.setHours(23, 59, 59, 999);

  if (isNaN(fi.getTime()) || isNaN(ff.getTime())) return {};

  return { fechaInicio: fi, fechaFin: ff };
};

export const resolverRangoFechas = (
  year?: number,
  month?: number,
  fechaInicioStr?: string,
  fechaFinStr?: string
): { fechaInicio?: Date; fechaFin?: Date } => {
  if (fechaInicioStr && fechaFinStr) {
    return buildDateRangeFromStrings(fechaInicioStr, fechaFinStr);
  }
  return buildDateRange(year, month);
};