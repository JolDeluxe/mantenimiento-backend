import { EstadoTarea } from "@prisma/client";
import { fechaKeyMX, instanteInicioMX } from "./periodos";
import { clasificarTrabajo } from "./clasificacion";
import type { IntervaloTrabajo, AcumuladoBuckets, CalidadDatosDiasLaborados } from "../types";

export interface ResultadoTiempoReal {
  tiempoRealPorDia: Record<string, AcumuladoBuckets>;
  fechasConIntervaloAbierto: string[];
  calidadDatos: Omit<CalidadDatosDiasLaborados, "tiempoProgramado" | "tareasSinTiempoProgramado">;
}

export function calcularTiempoReal(
  intervalos: IntervaloTrabajo[],
  desde: Date,
  hastaExclusivo: Date,
  ahora: Date
): ResultadoTiempoReal {
  const tiempoRealPorDia: Record<string, AcumuladoBuckets> = {};
  const fechasConIntervaloAbierto = new Set<string>();
  
  const calidadDatos: Omit<CalidadDatosDiasLaborados, "tiempoProgramado" | "tareasSinTiempoProgramado"> = {
    calendarioFestivos: "NO_CONFIGURADO",
    intervalosInvalidos: 0,
    intervalosAbiertosHistoricos: 0,
    intervalosFueraDeProgreso: 0,
    intervalosSinClasificacion: 0,
    minutosConClasificacionAmbigua: 0,
  };

  const inicializarDia = (diaKey: string) => {
    if (!tiempoRealPorDia[diaKey]) {
      tiempoRealPorDia[diaKey] = {
        ACTIVIDAD_REPORTE: 0,
        ACTIVIDAD_PLANEADA: 0,
        ACTIVIDAD_EXTRAORDINARIA: 0,
        MANTENIMIENTO_PREVENTIVO: 0,
        MANTENIMIENTO_CORRECTIVO: 0,
      };
    }
  };

  const hoyKey = fechaKeyMX(ahora);

  for (const inv of intervalos) {
    if (inv.estado !== EstadoTarea.EN_PROGRESO) {
      calidadDatos.intervalosFueraDeProgreso++;
      continue;
    }

    if (!inv.tarea) {
      calidadDatos.intervalosSinClasificacion++;
      continue;
    }

    const bucket = clasificarTrabajo(inv.tarea);
    if (!bucket) {
      calidadDatos.intervalosSinClasificacion++;
      continue;
    }

    const inicioMilis = Math.max(inv.inicio.getTime(), desde.getTime());
    let finMilis = 0;
    let fechaIntervaloAbierto: string | null = null;

    if (inv.fin) {
      finMilis = Math.min(inv.fin.getTime(), hastaExclusivo.getTime());
    } else {
      const inicioInvKey = fechaKeyMX(inv.inicio);
      if (inicioInvKey === hoyKey) {
        finMilis = Math.min(ahora.getTime(), hastaExclusivo.getTime());
        fechaIntervaloAbierto = inicioInvKey;
      } else {
        calidadDatos.intervalosAbiertosHistoricos++;
        continue;
      }
    }

    if (finMilis <= inicioMilis) {
      calidadDatos.intervalosInvalidos++;
      continue;
    }

    if (fechaIntervaloAbierto) {
      fechasConIntervaloAbierto.add(fechaIntervaloAbierto);
    }

    let cursor = new Date(inicioMilis);
    const limiteFin = new Date(finMilis);

    while (cursor < limiteFin) {
      const cursorDiaKey = fechaKeyMX(cursor);
      inicializarDia(cursorDiaKey);

      const mañanaKey = fechaKeyMX(new Date(cursor.getTime() + 24 * 60 * 60 * 1000));
      const medianocheSiguiente = instanteInicioMX(mañanaKey);

      const finFragmento = Math.min(limiteFin.getTime(), medianocheSiguiente.getTime());
      const duracionMinutos = (finFragmento - cursor.getTime()) / 60000;

      const dayBuckets = tiempoRealPorDia[cursorDiaKey];
      if (duracionMinutos > 0 && dayBuckets) {
        dayBuckets[bucket] += duracionMinutos;
      }

      cursor = new Date(finFragmento);
    }
  }

  for (const diaKey of Object.keys(tiempoRealPorDia)) {
    const buckets = tiempoRealPorDia[diaKey];
    if (buckets) {
      for (const bucket of Object.keys(buckets) as Array<keyof AcumuladoBuckets>) {
        buckets[bucket] = Math.round(buckets[bucket]);
      }
    }
  }

  return {
    tiempoRealPorDia,
    fechasConIntervaloAbierto: Array.from(fechasConIntervaloAbierto),
    calidadDatos,
  };
}
