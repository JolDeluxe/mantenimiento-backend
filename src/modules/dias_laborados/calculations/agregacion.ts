import { DIAS_LABORADOS_TIMEZONE, MINUTOS_DISPONIBLES, HORA_CIERRE } from "../constants";
import { fechaKeyMX, diaSemanaLocal, instanteInicioMX, getISOWeek } from "./periodos";
import type {
  FilaDiasLaborados,
  FilaMensualDiasLaborados,
  TiempoRealDesglose,
  AcumuladoBuckets,
  JornadaDia,
  EstadoFila,
  SummaryDiasLaborados,
} from "../types";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const NOMBRES_MESES = [
  "",
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const round2 = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function ratio(numerador: number, denominador: number): number | null {
  return denominador > 0 ? round2((numerador / denominador) * 100) : null;
}

function minutosDeHora(hora: string): number {
  const [horas, minutos] = hora.split(":").map(Number);
  return (horas ?? 0) * 60 + (minutos ?? 0);
}

function minutosDelDiaLocal(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: DIAS_LABORADOS_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const horas = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minutos = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return horas * 60 + minutos;
}

function esEnCurso(fecha: string, ahora: Date, domingoConAbierto: boolean): boolean {
  const hoyStr = fechaKeyMX(ahora);
  if (fecha !== hoyStr) return false;

  const dow = diaSemanaLocal(instanteInicioMX(fecha));
  if (dow === 0) return domingoConAbierto;

  const cierre = dow === 6 ? HORA_CIERRE.SABADO : HORA_CIERRE.SEMANA;
  return minutosDelDiaLocal(ahora) < minutosDeHora(cierre);
}

export function calcularDesgloseTiempoReal(buckets: AcumuladoBuckets): TiempoRealDesglose {
  const reportes = buckets.ACTIVIDAD_REPORTE;
  const planeadas = buckets.ACTIVIDAD_PLANEADA;
  const extraordinarias = buckets.ACTIVIDAD_EXTRAORDINARIA;
  const preventivos = buckets.MANTENIMIENTO_PREVENTIVO;
  const correctivos = buckets.MANTENIMIENTO_CORRECTIVO;

  const totalActividades = reportes + planeadas + extraordinarias;
  const totalMantenimientos = preventivos + correctivos;
  const totalMinutos = totalActividades + totalMantenimientos;

  return {
    totalMinutos,
    actividades: {
      totalMinutos: totalActividades,
      reportesMinutos: reportes,
      planeadasMinutos: planeadas,
      extraordinariasMinutos: extraordinarias,
    },
    mantenimientos: {
      totalMinutos: totalMantenimientos,
      preventivosMinutos: preventivos,
      correctivosMinutos: correctivos,
    },
  };
}

export function construirFilasDiarias(
  fechas: string[],
  tiempoRealPorDia: Record<string, AcumuladoBuckets>,
  planPorDia: Record<string, number>,
  ahora: Date,
  fechasConIntervaloAbierto: ReadonlySet<string> = new Set()
): FilaDiasLaborados[] {
  const filas: FilaDiasLaborados[] = [];
  const hoyStr = fechaKeyMX(ahora);

  for (const fKey of fechas) {
    const date = instanteInicioMX(fKey);
    const dow = diaSemanaLocal(date);

    const buckets = tiempoRealPorDia[fKey] || {
      ACTIVIDAD_REPORTE: 0,
      ACTIVIDAD_PLANEADA: 0,
      ACTIVIDAD_EXTRAORDINARIA: 0,
      MANTENIMIENTO_PREVENTIVO: 0,
      MANTENIMIENTO_CORRECTIVO: 0,
    };

    const tiempoReal = calcularDesgloseTiempoReal(buckets);
    const tiempoProgramadoMinutos = planPorDia[fKey] || 0;

    let jornada: JornadaDia = "ORDINARIA";
    let tiempoDisponibleMinutos: number = MINUTOS_DISPONIBLES.SEMANA;
    let laborado: "SI" | "SABADO" | "EXTRAORDINARIO" = "SI";

    if (dow === 6) {
      jornada = "SABADO";
      tiempoDisponibleMinutos = MINUTOS_DISPONIBLES.SABADO;
      laborado = "SABADO";
    } else if (dow === 0) {
      jornada = "EXTRAORDINARIO";
      tiempoDisponibleMinutos = MINUTOS_DISPONIBLES.DOMINGO;
      laborado = "EXTRAORDINARIO";

      if (tiempoReal.totalMinutos === 0) {
        continue;
      }
    }

    let estado: EstadoFila = "CERRADO";
    let provisional = false;

    if (fKey > hoyStr) {
      estado = "PROGRAMADO";
    } else if (esEnCurso(fKey, ahora, dow === 0 && fechasConIntervaloAbierto.has(fKey))) {
      estado = "EN_CURSO";
      provisional = true;
    }

    const realVsDisponible = ratio(tiempoReal.totalMinutos, tiempoDisponibleMinutos);
    const realVsPlan = ratio(tiempoReal.totalMinutos, tiempoProgramadoMinutos);

    const { week } = getISOWeek(fKey);

    filas.push({
      fecha: fKey,
      dia: DIAS[dow]!,
      laborado,
      jornada,
      estado,
      semana: week,
      mes: date.getMonth() + 1,
      tiempoDisponibleMinutos,
      tiempoProgramadoMinutos,
      tiempoReal,
      realVsDisponible,
      realVsPlan,
      provisional,
    });
  }

  return filas;
}

export function construirFilasMensuales(
  filasDiarias: FilaDiasLaborados[],
  year: number
): FilaMensualDiasLaborados[] {
  const desglosePorMes: Record<number, FilaDiasLaborados[]> = {};

  for (const fila of filasDiarias) {
    if (!desglosePorMes[fila.mes]) {
      desglosePorMes[fila.mes] = [];
    }
    desglosePorMes[fila.mes]!.push(fila);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const mes = index + 1;
    const filas = desglosePorMes[mes] || [];

    let tiempoDisponibleMinutos = 0;
    let tiempoProgramadoMinutos = 0;
    let provisional = false;

    const acumuladoBuckets: AcumuladoBuckets = {
      ACTIVIDAD_REPORTE: 0,
      ACTIVIDAD_PLANEADA: 0,
      ACTIVIDAD_EXTRAORDINARIA: 0,
      MANTENIMIENTO_PREVENTIVO: 0,
      MANTENIMIENTO_CORRECTIVO: 0,
    };

    for (const f of filas) {
      tiempoDisponibleMinutos += f.tiempoDisponibleMinutos;
      tiempoProgramadoMinutos += f.tiempoProgramadoMinutos;
      if (f.provisional) provisional = true;

      acumuladoBuckets.ACTIVIDAD_REPORTE += f.tiempoReal.actividades.reportesMinutos;
      acumuladoBuckets.ACTIVIDAD_PLANEADA += f.tiempoReal.actividades.planeadasMinutos;
      acumuladoBuckets.ACTIVIDAD_EXTRAORDINARIA += f.tiempoReal.actividades.extraordinariasMinutos;
      acumuladoBuckets.MANTENIMIENTO_PREVENTIVO += f.tiempoReal.mantenimientos.preventivosMinutos;
      acumuladoBuckets.MANTENIMIENTO_CORRECTIVO += f.tiempoReal.mantenimientos.correctivosMinutos;
    }

    const tiempoReal = calcularDesgloseTiempoReal(acumuladoBuckets);

    const realVsDisponible = ratio(tiempoReal.totalMinutos, tiempoDisponibleMinutos);
    const realVsPlan = ratio(tiempoReal.totalMinutos, tiempoProgramadoMinutos);

    return {
      mes,
      mesNombre: NOMBRES_MESES[mes] || "",
      periodo: `${year}-${String(mes).padStart(2, "0")}`,
      tiempoDisponibleMinutos,
      tiempoProgramadoMinutos,
      tiempoReal,
      realVsDisponible,
      realVsPlan,
      provisional,
    };
  });
}

export function construirSummary(filasDiarias: FilaDiasLaborados[]): SummaryDiasLaborados {
  let tiempoDisponibleMinutos = 0;
  let tiempoProgramadoMinutos = 0;

  const acumuladoBuckets: AcumuladoBuckets = {
    ACTIVIDAD_REPORTE: 0,
    ACTIVIDAD_PLANEADA: 0,
    ACTIVIDAD_EXTRAORDINARIA: 0,
    MANTENIMIENTO_PREVENTIVO: 0,
    MANTENIMIENTO_CORRECTIVO: 0,
  };

  for (const fila of filasDiarias) {
    tiempoDisponibleMinutos += fila.tiempoDisponibleMinutos;
    tiempoProgramadoMinutos += fila.tiempoProgramadoMinutos;
    acumuladoBuckets.ACTIVIDAD_REPORTE += fila.tiempoReal.actividades.reportesMinutos;
    acumuladoBuckets.ACTIVIDAD_PLANEADA += fila.tiempoReal.actividades.planeadasMinutos;
    acumuladoBuckets.ACTIVIDAD_EXTRAORDINARIA += fila.tiempoReal.actividades.extraordinariasMinutos;
    acumuladoBuckets.MANTENIMIENTO_PREVENTIVO += fila.tiempoReal.mantenimientos.preventivosMinutos;
    acumuladoBuckets.MANTENIMIENTO_CORRECTIVO += fila.tiempoReal.mantenimientos.correctivosMinutos;
  }

  const tiempoReal = calcularDesgloseTiempoReal(acumuladoBuckets);

  return {
    tiempoDisponibleMinutos,
    tiempoProgramadoMinutos,
    tiempoReal,
    realVsDisponible: ratio(tiempoReal.totalMinutos, tiempoDisponibleMinutos),
    realVsPlan: ratio(tiempoReal.totalMinutos, tiempoProgramadoMinutos),
    provisional: filasDiarias.some((row) => row.provisional),
  };
}
