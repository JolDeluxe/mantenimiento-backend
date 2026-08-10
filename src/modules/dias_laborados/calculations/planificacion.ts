import { EstadoTarea } from "@prisma/client";
import { ESTADOS_PLAN_EXCLUIDOS } from "../constants";
import { fechaKeyMX, instanteInicioMX, sumarDiasKey } from "./periodos";

export interface TareaPlanificable {
  id: number;
  estado: EstadoTarea;
  horaInicioProgramada: Date | null;
  horaFinProgramada: Date | null;
  fechaProgramadaPreventiva?: Date | null;
  fechaCicloLogica?: Date | null;
  fechaVencimiento?: Date | null;
  tiempoEstimado: number | null;
}

export interface PreventivoRecurrente {
  id: number;
  frecuenciaDias: number;
  ultimoMantenimiento: Date | null;
  tiempoEstimadoMinutos: number;
}

export interface ResultadoPlanificacion {
  planPorDia: Record<string, number>;
  tareasSinTiempoProgramado: number;
}

export function calcularPlanTareas(
  tareas: TareaPlanificable[],
  desde: Date,
  hastaExclusivo: Date,
  preventivos: PreventivoRecurrente[] = []
): ResultadoPlanificacion {
  const planPorDia: Record<string, number> = {};
  let tareasSinTiempoProgramado = 0;

  const inicializarDia = (diaKey: string) => {
    if (planPorDia[diaKey] === undefined) {
      planPorDia[diaKey] = 0;
    }
  };

  const sumarPlan = (diaKey: string, minutos: number) => {
    inicializarDia(diaKey);
    planPorDia[diaKey]! += minutos;
  };

  const sumarRangoProgramado = (inicio: Date, fin: Date) => {
    const inicioMs = Math.max(inicio.getTime(), desde.getTime());
    const finMs = Math.min(fin.getTime(), hastaExclusivo.getTime());
    if (finMs <= inicioMs) return 0;

    let minutos = 0;
    let cursor = new Date(inicioMs);
    const limite = new Date(finMs);

    while (cursor < limite) {
      const diaKey = fechaKeyMX(cursor);
      const siguienteDia = instanteInicioMX(sumarDiasKey(diaKey, 1));
      const finFragmentoMs = Math.min(limite.getTime(), siguienteDia.getTime());
      const fragmentoMinutos = (finFragmentoMs - cursor.getTime()) / 60000;

      if (fragmentoMinutos > 0) {
        sumarPlan(diaKey, fragmentoMinutos);
        minutos += fragmentoMinutos;
      }

      cursor = new Date(finFragmentoMs);
    }

    return minutos;
  };

  const obtenerFechaProgramada = (t: TareaPlanificable): Date | null =>
    t.horaInicioProgramada ||
    t.fechaProgramadaPreventiva ||
    t.fechaCicloLogica ||
    t.fechaVencimiento ||
    null;

  // 1. Tareas programadas reales existentes
  for (const t of tareas) {
    if ((ESTADOS_PLAN_EXCLUIDOS as readonly string[]).includes(t.estado)) {
      continue;
    }

    let duracionMinutos = 0;

    // A. Prioridad 1: Rango de horas programadas
    if (t.horaInicioProgramada && t.horaFinProgramada) {
      const diffMs = t.horaFinProgramada.getTime() - t.horaInicioProgramada.getTime();
      if (diffMs > 0) {
        duracionMinutos = diffMs / 60000;
        sumarRangoProgramado(t.horaInicioProgramada, t.horaFinProgramada);
        continue;
      }
    }

    // B. Prioridad 2: Tiempo estimado
    if (duracionMinutos === 0 && t.tiempoEstimado && t.tiempoEstimado > 0) {
      duracionMinutos = t.tiempoEstimado;
    }

    if (duracionMinutos === 0) {
      tareasSinTiempoProgramado++;
    }

    const fechaRef = obtenerFechaProgramada(t);
    if (!fechaRef) {
      continue;
    }

    sumarPlan(fechaKeyMX(fechaRef), duracionMinutos);
  }

  // 2. Simulación de preventivos recurrentes para días futuros
  const hoyStr = fechaKeyMX(new Date());
  
  for (const prev of preventivos) {
    const cursor = new Date(desde.getTime());
    while (cursor < hastaExclusivo) {
      const cursorStr = fechaKeyMX(cursor);
      
      if (cursorStr > hoyStr) {
        inicializarDia(cursorStr);
        const ultimoMs = prev.ultimoMantenimiento?.getTime() || desde.getTime();
        const diffDias = Math.floor((cursor.getTime() - ultimoMs) / (24 * 60 * 60 * 1000));
        
        if (diffDias > 0 && diffDias % prev.frecuenciaDias === 0) {
          planPorDia[cursorStr]! += prev.tiempoEstimadoMinutos;
        }
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  for (const dia of Object.keys(planPorDia)) {
    planPorDia[dia] = Math.round(planPorDia[dia] ?? 0);
  }

  return {
    planPorDia,
    tareasSinTiempoProgramado,
  };
}
