import { EstadoTarea } from "@prisma/client";

export const UMBRAL_DATOS_SUFICIENTES = 3;

/**
 * KPI por tarea individual (0-100):
 * 50 pts  → tarea en RESUELTO o CERRADO
 * 40 pts  → finalizadoAt <= fechaVencimiento (SLA cumplido)
 * 10 pts  → 0 < duracionReal < tiempoEstimado (eficiencia temporal)
 */
export const calcularKpiTarea = (tarea: {
  estado: EstadoTarea;
  finalizadoAt: Date | null;
  fechaVencimiento: Date | null;
  duracionReal: number | null;
  tiempoEstimado: number | null;
}): number => {
  const ESTADOS_TERMINADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
  
  if (!ESTADOS_TERMINADOS.includes(tarea.estado)) return 0;

  let kpi = 50;

  if (tarea.finalizadoAt && tarea.fechaVencimiento) {
    if (tarea.finalizadoAt <= tarea.fechaVencimiento) {
      kpi += 40;
    }
  }

  const duracion = tarea.duracionReal ?? 0;
  if (
    duracion > 0 &&
    tarea.tiempoEstimado !== null &&
    tarea.tiempoEstimado > 0 &&
    duracion < tarea.tiempoEstimado
  ) {
    kpi += 10;
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
      fechaFin: new Date(year, 11, 31, 23, 59, 59, 999),
    };
  }

  const lastDay = new Date(year, month, 0).getDate();
  return {
    fechaInicio: new Date(year, month - 1, 1, 0, 0, 0, 0),
    fechaFin: new Date(year, month - 1, lastDay, 23, 59, 59, 999),
  };
};