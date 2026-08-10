export const DIAS_LABORADOS_TIMEZONE = "America/Mexico_City";

export const MINUTOS_DISPONIBLES = {
  SEMANA: 5400,
  SABADO: 3600,
  DOMINGO: 0,
} as const;

export const HORA_CIERRE = {
  SEMANA: "17:30",
  SABADO: "14:00",
} as const;

export const ESTADOS_PLAN_EXCLUIDOS = ["CANCELADA"] as const;
