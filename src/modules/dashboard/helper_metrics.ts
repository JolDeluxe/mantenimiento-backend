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
  
  // Si no está terminada, no tiene puntaje de desempeño aún
  if (!ESTADOS_TERMINADOS.includes(tarea.estado)) return 0;

  let kpiObtenido = 20; // 20 pts base por el simple hecho de terminarla
  let kpiMaximo = 100;  // El total posible acumulable

  // 1. EVALUAR PUNTUALIDAD (40 pts)
  if (tarea.fechaVencimiento && tarea.finalizadoAt) {
    // NORMALIZACIÓN: Quitamos horas, minutos y segundos para comparar solo el CALENDARIO
    const fFin = new Date(tarea.finalizadoAt).setHours(0, 0, 0, 0);
    const fVenc = new Date(tarea.fechaVencimiento).setHours(0, 0, 0, 0);

    if (fFin <= fVenc) {
      kpiObtenido += 40; // Se ganó sus puntos (entregó antes o el mismo día)
    }
    // Si fFin > fVenc, no suma estos 40 puntos (penalización por tardanza)
  } else if (!tarea.fechaVencimiento) {
    // REGLA DE JUSTICIA: Si no se le asignó fecha límite, no podemos evaluarlo
    kpiMaximo -= 40; 
  }

  // 2. EVALUAR EFICIENCIA DE TIEMPO (20 pts)
  if (tarea.tiempoEstimado && tarea.tiempoEstimado > 0) {
    const duracion = tarea.duracionReal ?? 0;
    if (duracion > 0 && duracion <= tarea.tiempoEstimado) {
      kpiObtenido += 20; // Cumplió con el tiempo que prometió o estimó
    }
  } else {
    // REGLA DE JUSTICIA: Sin tiempo estimado no hay penalización por excederse
    kpiMaximo -= 20; 
  }

  // 3. EVALUAR CALIDAD A LA PRIMERA (20 pts)
  // El historial filtrado solo trae registros de tipo RECHAZADO (según el query del módulo)
  if (tarea.historial.length === 0) {
    kpiObtenido += 20; // El trabajo fue aceptado sin correcciones
  }

  // 4. CALCULAR PORCENTAJE FINAL
  // Evitamos división por cero y devolvemos la relación porcentual real
  if (kpiMaximo <= 0) return 100; 
  
  return (kpiObtenido / kpiMaximo) * 100;
};

export const calcularKpiAgregado = (
  kpis: number[]
): { kpiPromedio: number; datosSuficientes: boolean } => {
  const datosSuficientes = kpis.length >= UMBRAL_DATOS_SUFICIENTES;
  if (kpis.length === 0) return { kpiPromedio: 0, datosSuficientes: false };
  
  // Devuelve el flotante puro
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

  // Separar los valores a mano evita que JS asuma UTC por el formato YYYY-MM-DD
  // Se agregan valores por defecto para evitar errores de TypeScript (undefined)
  const [y1 = 0, m1 = 1, d1 = 1] = fechaInicioStr.split('-').map(Number);
  const [y2 = 0, m2 = 1, d2 = 1] = fechaFinStr.split('-').map(Number);

  // new Date(Año, Mes (0-11), Día, Hora, Minuto, Segundo) -> Usa hora LOCAL siempre
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
  if (fechaInicioStr && fechaFinStr) {
    return buildDateRangeFromStrings(fechaInicioStr, fechaFinStr);
  }
  return buildDateRange(year, month);
};