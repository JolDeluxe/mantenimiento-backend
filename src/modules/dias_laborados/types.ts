import type { ClasificacionTarea, EstadoTarea, TipoTarea } from "@prisma/client";

export type PeriodoDiasLaborados = "SEMANA" | "MES" | "ANIO";
export type GranularidadDiasLaborados = "DIA" | "MES";
export type JornadaDia = "ORDINARIA" | "SABADO" | "EXTRAORDINARIO";
export type EstadoFila = "CERRADO" | "EN_CURSO" | "PROGRAMADO";

export type BucketTrabajo =
  | "ACTIVIDAD_REPORTE"
  | "ACTIVIDAD_PLANEADA"
  | "ACTIVIDAD_EXTRAORDINARIA"
  | "MANTENIMIENTO_PREVENTIVO"
  | "MANTENIMIENTO_CORRECTIVO";

export type TareaClasificable = {
  tipo: TipoTarea;
  clasificacion: ClasificacionTarea | null;
  maquinaId: number | null;
};

export type IntervaloTrabajo = {
  id: number;
  usuarioId: number;
  estado: EstadoTarea;
  inicio: Date;
  fin: Date | null;
  tarea: TareaClasificable;
};

export type PeriodoCalculado = {
  periodo: PeriodoDiasLaborados;
  anio: number;
  semana: number | null;
  mes: number | null;
  desdeFecha: string;
  hastaFecha: string;
  desde: Date;
  hastaExclusivo: Date;
  granularidad: GranularidadDiasLaborados;
};

export type TiempoRealDesglose = {
  totalMinutos: number;
  actividades: {
    totalMinutos: number;
    reportesMinutos: number;
    planeadasMinutos: number;
    extraordinariasMinutos: number;
  };
  mantenimientos: {
    totalMinutos: number;
    preventivosMinutos: number;
    correctivosMinutos: number;
  };
};

export type SummaryDiasLaborados = {
  tiempoDisponibleMinutos: number;
  tiempoProgramadoMinutos: number;
  tiempoReal: TiempoRealDesglose;
  realVsDisponible: number | null;
  realVsPlan: number | null;
  provisional: boolean;
};

export type AcumuladoBuckets = Record<BucketTrabajo, number>;

export type CalidadDatosDiasLaborados = {
  tiempoProgramado: "COMPLETO" | "PARCIAL" | "HISTORICO_SIN_TIEMPO_PROGRAMADO";
  calendarioFestivos: "NO_CONFIGURADO";
  tareasSinTiempoProgramado: number;
  intervalosInvalidos: number;
  intervalosAbiertosHistoricos: number;
  intervalosFueraDeProgreso: number;
  intervalosSinClasificacion: number;
  minutosConClasificacionAmbigua: number;
};

export type FilaDiasLaborados = {
  fecha: string;
  dia: string;
  laborado: "SI" | "SABADO" | "EXTRAORDINARIO";
  jornada: JornadaDia;
  estado: EstadoFila;
  semana: number;
  mes: number;
  tiempoDisponibleMinutos: number;
  tiempoProgramadoMinutos: number;
  tiempoReal: TiempoRealDesglose;
  realVsDisponible: number | null;
  realVsPlan: number | null;
  provisional: boolean;
};

export type FilaMensualDiasLaborados = {
  mes: number;
  mesNombre: string;
  periodo: string;
  tiempoDisponibleMinutos: number;
  tiempoProgramadoMinutos: number;
  tiempoReal: TiempoRealDesglose;
  realVsDisponible: number | null;
  realVsPlan: number | null;
  provisional: boolean;
};
