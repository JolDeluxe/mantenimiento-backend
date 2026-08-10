import { normalizeMachineCode, generateRowFingerprint } from "./fingerprint";
import type { RawHistoricalRow, ParsedHistoricalRecord } from "./types";

/**
 * Convierte fecha (DD/MM/YY) y hora (HH:mm) a un objeto Date en huso horario local de México.
 * No utiliza new Date("07/01/25") ambiguo.
 */
export function parseLocalMexicoDate(fechaStr: string, horaStr: string): Date | null {
  if (!fechaStr || !horaStr) return null;

  const fechaParts = fechaStr.trim().split("/");
  if (fechaParts.length !== 3) return null;

  const day = parseInt(fechaParts[0]!, 10);
  const month = parseInt(fechaParts[1]!, 10);
  let year = parseInt(fechaParts[2]!, 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  // Ajustar año de 2 dígitos (ej: 25 -> 2025, 26 -> 2026)
  if (year < 100) {
    year += 2000;
  }

  const horaParts = horaStr.trim().split(":");
  if (horaParts.length < 2) return null;

  const hours = parseInt(horaParts[0]!, 10);
  const minutes = parseInt(horaParts[1]!, 10);

  if (isNaN(hours) || isNaN(minutes)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  // Construir la fecha en hora México
  // Creamos la fecha local y ajustamos string ISO o UTC compensando offset (-06:00)
  const pad = (n: number) => n.toString().padStart(2, "0");
  const isoStr = `${year}-${pad(month)}-${pad(day)}T${pad(hours)}:${pad(minutes)}:00-06:00`;
  const d = new Date(isoStr);

  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normaliza y valida técnicamente un registro individual del archivo fuente.
 */
export function normalizeAndValidateRow(raw: RawHistoricalRow): ParsedHistoricalRecord {
  const codigoNorm = normalizeMachineCode(raw.equipo);

  const fingerprint = generateRowFingerprint(
    raw.columna1,
    codigoNorm,
    raw.horaInicio,
    raw.horaFin,
    raw.tiempoReparacion,
    raw.departamento,
    raw.linea
  );

  // 1. Validar código de máquina
  if (!codigoNorm) {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: "",
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "CODIGO_MAQUINA_INVALIDO",
      errorDetail: "La columna de equipo/código está vacía o malformada.",
      fingerprint,
    };
  }

  if (codigoNorm === "MBMC071") {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "CODIGO_MAQUINA_INVALIDO",
      errorDetail: "Código anómalo MBMC071 no corresponde al catálogo oficial.",
      fingerprint,
    };
  }

  // 2. Validar fecha
  if (!raw.columna1 || raw.columna1.trim() === "") {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "FECHA_INVALIDA",
      errorDetail: "La fecha del registro está vacía.",
      fingerprint,
    };
  }

  // 3. Validar horas
  if (!raw.horaInicio || raw.horaInicio.trim() === "") {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "HORA_INICIO_FALTANTE",
      errorDetail: "La hora de inicio está vacía.",
      fingerprint,
    };
  }

  if (!raw.horaFin || raw.horaFin.trim() === "") {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "HORA_FIN_FALTANTE",
      errorDetail: "La hora de fin está vacía.",
      fingerprint,
    };
  }

  // 4. Parsear fechas completas
  const fechaInicio = parseLocalMexicoDate(raw.columna1, raw.horaInicio);
  const fechaFin = parseLocalMexicoDate(raw.columna1, raw.horaFin);

  if (!fechaInicio || !fechaFin) {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio: null,
      fechaFin: null,
      duracionMinutos: null,
      isValid: false,
      errorCode: "FECHA_INVALIDA",
      errorDetail: "No se pudo interpretar el formato de fecha u hora.",
      fingerprint,
    };
  }

  // 5. Validar duración
  let duracionMinutos = parseInt(raw.tiempoReparacion, 10);

  if (isNaN(duracionMinutos) && raw.trHora && raw.trMin) {
    const hrs = parseInt(raw.trHora, 10) || 0;
    const mins = parseInt(raw.trMin, 10) || 0;
    duracionMinutos = hrs * 60 + mins;
  }

  if (isNaN(duracionMinutos) || duracionMinutos <= 0) {
    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio,
      fechaFin,
      duracionMinutos: null,
      isValid: false,
      errorCode: "DURACION_INVALIDA",
      errorDetail: `Duración no válida o menor o igual a cero (${raw.tiempoReparacion}).`,
      fingerprint,
    };
  }

  // Validar si fin <= inicio
  if (fechaFin.getTime() <= fechaInicio.getTime()) {
    // Si cruza la medianoche (ej: 23:30 a 00:15)
    const finAjustado = new Date(fechaFin.getTime() + 24 * 60 * 60 * 1000);
    const diffMins = Math.round((finAjustado.getTime() - fechaInicio.getTime()) / 60000);

    if (diffMins === duracionMinutos) {
      // Ajuste de medianoche válido
      return {
        rowNumber: raw.rowNumber,
        raw,
        codigoMaquinaNorm: codigoNorm,
        fechaInicio,
        fechaFin: finAjustado,
        duracionMinutos,
        isValid: true,
        errorCode: null,
        errorDetail: null,
        fingerprint,
      };
    }

    return {
      rowNumber: raw.rowNumber,
      raw,
      codigoMaquinaNorm: codigoNorm,
      fechaInicio,
      fechaFin,
      duracionMinutos,
      isValid: false,
      errorCode: "RANGO_TEMPORAL_INVALIDO",
      errorDetail: `La hora de fin (${raw.horaFin}) es menor o igual que el inicio (${raw.horaInicio}) sin coincidencia de duración.`,
      fingerprint,
    };
  }

  return {
    rowNumber: raw.rowNumber,
    raw,
    codigoMaquinaNorm: codigoNorm,
    fechaInicio,
    fechaFin,
    duracionMinutos,
    isValid: true,
    errorCode: null,
    errorDetail: null,
    fingerprint,
  };
}
