export const TURNO_TIMEZONE = "America/Mexico_City";

export type TipoJornadaTurno = "SEMANA" | "SABADO";

export interface TurnoOperativoConfig {
  tipo: TipoJornadaTurno;
  horaAdvertencia: string;
  horaFin: string;
  horaAutoPausa: string;
}

export const TURNO_CONFIG: Record<TipoJornadaTurno, TurnoOperativoConfig> = {
  SEMANA: {
    tipo: "SEMANA",
    horaAdvertencia: "17:15",
    horaFin: "17:30",
    horaAutoPausa: "17:45",
  },
  SABADO: {
    tipo: "SABADO",
    horaAdvertencia: "13:45",
    horaFin: "14:00",
    horaAutoPausa: "14:15",
  },
};

export const getMXDateParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TURNO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: value("weekday"),
  };
};

const getMXOffsetMinutes = (date: Date) => {
  const localString = date.toLocaleString("en-US", { timeZone: TURNO_TIMEZONE });
  const localDate = new Date(localString);
  const utcString = date.toLocaleString("en-US", { timeZone: "UTC" });
  const utcDate = new Date(utcString);
  return Math.round((localDate.getTime() - utcDate.getTime()) / 60000);
};

export const dateFromMXLocal = (
  year: number,
  month: number,
  day: number,
  timeHHmm: string,
) => {
  const [hour = "00", minute = "00"] = timeHHmm.split(":");
  const nominalUTC = new Date(Date.UTC(year, month - 1, day, Number(hour), Number(minute), 0, 0));
  const offsetMinutes = getMXOffsetMinutes(nominalUTC);
  return new Date(nominalUTC.getTime() - offsetMinutes * 60000);
};

export const getTipoJornadaTurno = (date: Date): TipoJornadaTurno | null => {
  const { weekday } = getMXDateParts(date);
  if (weekday === "Sun") return null;
  if (weekday === "Sat") return "SABADO";
  return "SEMANA";
};

export const getFinOficialTurno = (date: Date, tipoJornada?: TipoJornadaTurno) => {
  const tipo = tipoJornada ?? getTipoJornadaTurno(date);
  if (!tipo) return null;

  const { year, month, day } = getMXDateParts(date);
  return dateFromMXLocal(year, month, day, TURNO_CONFIG[tipo].horaFin);
};
