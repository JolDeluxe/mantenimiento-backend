/**
 * bi_maquinaria/calculations/mttr.ts
 *
 * MTTR técnico: tiempo transcurrido real con trabajo técnico activo.
 * No usa jornada laboral, no suma persona-minutos y no incluye pausas/noches.
 */

export interface FallaMTTRInput {
  id: number;
  tareaId: number | null;
  fechaFallaConfirmada: Date | null;
  fechaRestauracion: Date | null;
  estado: string;
  contabilizaComoFalla: boolean;
}

export interface IntervaloTecnicoInput {
  id: number;
  tareaId: number;
  inicio: Date;
  fin: Date | null;
}

export interface IntervaloTecnicoNormalizado {
  id: number;
  inicio: Date;
  fin: Date;
  minutos: number;
}

export interface IntervaloTecnicoInvalido {
  id: number;
  razon: string;
  inicio: Date | null;
  fin: Date | null;
}

export interface FallaTecnicaDetalle {
  fallaId: number;
  tareaId: number | null;
  calculable: boolean;
  razonExclusion: string | null;
  advertencias: string[];
  primerInicioTecnico: Date | null;
  tiempoRespuestaMinutos: number | null;
  tiempoTecnicoActivoMinutos: number | null;
  tiempoCalendarioRestauracionMinutos: number | null;
  intervalosOriginales: IntervaloTecnicoInput[];
  intervalosEfectivos: IntervaloTecnicoNormalizado[];
  intervalosFusionados: IntervaloTecnicoNormalizado[];
  intervalosInvalidos: IntervaloTecnicoInvalido[];
}

export interface MTTRResult {
  valorMinutos: number | null;
  sumaMinutosTrabajoTecnico: number;
  /**
   * Alias temporal de compatibilidad. En contrato 2.1 representa trabajo técnico,
   * no duración calendario.
   */
  sumaMinutosRestauracion: number;
  fallasRestauradasUsadas: number;
  fallasAbiertasExcluidas: number;
  fallasInvalidasExcluidas: number;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

export interface TiempoRespuestaResult {
  valorPromedioMinutos: number | null;
  sumaMinutos: number;
  fallasUsadas: number;
  estado: MTTRResult["estado"];
  advertencias: string[];
}

export interface RestauracionCalendarioResult {
  valorPromedioMinutos: number | null;
  sumaMinutos: number;
  fallasUsadas: number;
  estado: MTTRResult["estado"];
  advertencias: string[];
}

export interface MetricasTecnicasResult {
  mttr: MTTRResult;
  tiempoRespuesta: TiempoRespuestaResult;
  restauracionCalendario: RestauracionCalendarioResult;
  detalles: FallaTecnicaDetalle[];
}

const differenceMinutes = (start: Date, end: Date) =>
  Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));

const uniqueWarnings = (warnings: string[]) => Array.from(new Set(warnings));

const buildEmptyMetric = <T extends { valorPromedioMinutos: number | null; sumaMinutos: number; fallasUsadas: number; estado: MTTRResult["estado"]; advertencias: string[] }>(
  metric: T,
  totalFallasConfirmadas: number,
) => {
  if (totalFallasConfirmadas === 0) {
    metric.estado = "SIN_DATOS";
  } else if (metric.fallasUsadas === 0) {
    metric.estado = "MUESTRA_INSUFICIENTE";
  } else {
    metric.valorPromedioMinutos = metric.sumaMinutos / metric.fallasUsadas;
    metric.estado = "CALCULABLE";
  }
  return metric;
};

export const normalizarIntervalosTecnicosFalla = (
  falla: FallaMTTRInput,
  intervalos: IntervaloTecnicoInput[],
): FallaTecnicaDetalle => {
  const advertencias: string[] = [];
  const invalidos: IntervaloTecnicoInvalido[] = [];

  const base: FallaTecnicaDetalle = {
    fallaId: falla.id,
    tareaId: falla.tareaId,
    calculable: false,
    razonExclusion: null,
    advertencias,
    primerInicioTecnico: null,
    tiempoRespuestaMinutos: null,
    tiempoTecnicoActivoMinutos: null,
    tiempoCalendarioRestauracionMinutos: null,
    intervalosOriginales: intervalos,
    intervalosEfectivos: [],
    intervalosFusionados: [],
    intervalosInvalidos: invalidos,
  };

  if (!falla.contabilizaComoFalla || !falla.fechaFallaConfirmada) return base;
  if (!falla.tareaId) {
    base.razonExclusion = "FALLA_SIN_TAREA_VINCULADA";
    advertencias.push("FALLA_SIN_TAREA_VINCULADA");
    return base;
  }
  if (falla.estado === "ABIERTA" || !falla.fechaRestauracion) {
    base.razonExclusion = "FALLA_ABIERTA_MTTR";
    return base;
  }
  if (falla.fechaRestauracion.getTime() < falla.fechaFallaConfirmada.getTime()) {
    base.razonExclusion = "FECHA_RESTAURACION_INVALIDA";
    advertencias.push("FECHA_RESTAURACION_INVALIDA");
    return base;
  }

  base.tiempoCalendarioRestauracionMinutos = differenceMinutes(
    falla.fechaFallaConfirmada,
    falla.fechaRestauracion,
  );

  const efectivos: IntervaloTecnicoNormalizado[] = [];
  for (const intervalo of intervalos) {
    if (!intervalo.inicio) {
      invalidos.push({ id: intervalo.id, razon: "INTERVALO_TECNICO_INVALIDO", inicio: null, fin: intervalo.fin });
      continue;
    }
    if (!intervalo.fin) {
      invalidos.push({ id: intervalo.id, razon: "INTERVALO_TECNICO_ABIERTO", inicio: intervalo.inicio, fin: null });
      advertencias.push("INTERVALO_TECNICO_ABIERTO");
      continue;
    }
    if (intervalo.fin.getTime() <= intervalo.inicio.getTime()) {
      invalidos.push({ id: intervalo.id, razon: "INTERVALO_TECNICO_INVALIDO", inicio: intervalo.inicio, fin: intervalo.fin });
      advertencias.push("INTERVALO_TECNICO_INVALIDO");
      continue;
    }

    const inicio = intervalo.inicio;
    const fin = intervalo.fin;
    efectivos.push({ id: intervalo.id, inicio, fin, minutos: differenceMinutes(inicio, fin) });
  }

  base.intervalosEfectivos = efectivos.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  if (base.intervalosEfectivos.length === 0) {
    base.razonExclusion = invalidos.length > 0 ? "FALLA_SIN_INICIO_TECNICO" : "FALLA_RESTAURADA_SIN_INTERVALOS";
    advertencias.push(base.razonExclusion);
    return base;
  }

  const primer = base.intervalosEfectivos[0]!;
  base.primerInicioTecnico = primer.inicio;
  base.tiempoRespuestaMinutos = differenceMinutes(falla.fechaFallaConfirmada, primer.inicio);

  const fusionados: IntervaloTecnicoNormalizado[] = [];
  for (const intervalo of base.intervalosEfectivos) {
    const ultimo = fusionados[fusionados.length - 1];
    if (!ultimo || intervalo.inicio.getTime() > ultimo.fin.getTime()) {
      fusionados.push({ ...intervalo });
      continue;
    }
    if (intervalo.inicio.getTime() < ultimo.fin.getTime()) {
      advertencias.push("INTERVALOS_TECNICOS_SUPERPUESTOS");
    }
    if (intervalo.fin.getTime() > ultimo.fin.getTime()) {
      ultimo.fin = intervalo.fin;
      ultimo.minutos = differenceMinutes(ultimo.inicio, ultimo.fin);
    }
  }

  base.intervalosFusionados = fusionados;
  base.tiempoTecnicoActivoMinutos = fusionados.reduce((acc, intervalo) => acc + intervalo.minutos, 0);
  base.calculable = base.tiempoTecnicoActivoMinutos > 0;
  if (!base.calculable) {
    base.razonExclusion = "FALLA_SIN_INICIO_TECNICO";
    advertencias.push("FALLA_SIN_INICIO_TECNICO");
  }
  base.advertencias = uniqueWarnings(advertencias);
  return base;
};

export function calcularMetricasTecnicasFallas(
  fallas: FallaMTTRInput[],
  intervalosPorTareaId: Map<number, IntervaloTecnicoInput[]>,
  desde: Date,
  hastaEfectivo: Date,
): MetricasTecnicasResult {
  let totalFallasConfirmadas = 0;
  let abiertas = 0;
  let invalidas = 0;
  let sumaTrabajo = 0;
  let fallasTrabajoUsadas = 0;
  let sumaRespuesta = 0;
  let fallasRespuestaUsadas = 0;
  let sumaCalendario = 0;
  let fallasCalendarioUsadas = 0;
  const advertencias: string[] = [];
  const detalles: FallaTecnicaDetalle[] = [];

  for (const f of fallas) {
    if (!f.contabilizaComoFalla || !f.fechaFallaConfirmada) continue;

    const confirmadaTime = f.fechaFallaConfirmada.getTime();
    if (confirmadaTime < desde.getTime() || confirmadaTime >= hastaEfectivo.getTime()) {
      continue;
    }

    totalFallasConfirmadas++;
    const intervalos = f.tareaId ? (intervalosPorTareaId.get(f.tareaId) ?? []) : [];
    const detalle = normalizarIntervalosTecnicosFalla(f, intervalos);
    detalles.push(detalle);
    detalle.advertencias.forEach((warning) => advertencias.push(warning));

    if (f.estado === "ABIERTA" || !f.fechaRestauracion) {
      abiertas++;
      continue;
    }

    if (detalle.tiempoCalendarioRestauracionMinutos !== null) {
      sumaCalendario += detalle.tiempoCalendarioRestauracionMinutos;
      fallasCalendarioUsadas++;
    }

    if (detalle.calculable && detalle.tiempoTecnicoActivoMinutos !== null) {
      sumaTrabajo += detalle.tiempoTecnicoActivoMinutos;
      fallasTrabajoUsadas++;
      if (detalle.tiempoRespuestaMinutos !== null) {
        sumaRespuesta += detalle.tiempoRespuestaMinutos;
        fallasRespuestaUsadas++;
      }
    } else {
      invalidas++;
      if (detalle.razonExclusion) advertencias.push(detalle.razonExclusion);
    }
  }

  let mttrValor: number | null = 0;
  let mttrEstado: MTTRResult["estado"] = "SIN_DATOS";
  if (totalFallasConfirmadas === 0) {
    mttrEstado = "SIN_DATOS";
  } else if (fallasTrabajoUsadas === 0) {
    mttrEstado = "MUESTRA_INSUFICIENTE";
    advertencias.push("FALLAS_RESTAURADAS_INSUFICIENTES");
  } else {
    mttrValor = sumaTrabajo / fallasTrabajoUsadas;
    mttrEstado = "CALCULABLE";
  }
  if (abiertas > 0) advertencias.push("FALLAS_ABIERTAS_EXCLUIDAS_MTTR");

  const mttr: MTTRResult = {
    valorMinutos: mttrValor,
    sumaMinutosTrabajoTecnico: sumaTrabajo,
    sumaMinutosRestauracion: sumaTrabajo,
    fallasRestauradasUsadas: fallasTrabajoUsadas,
    fallasAbiertasExcluidas: abiertas,
    fallasInvalidasExcluidas: invalidas,
    estado: mttrEstado,
    advertencias: uniqueWarnings(advertencias),
  };

  const tiempoRespuesta = buildEmptyMetric({
    valorPromedioMinutos: null,
    sumaMinutos: sumaRespuesta,
    fallasUsadas: fallasRespuestaUsadas,
    estado: "SIN_DATOS" as MTTRResult["estado"],
    advertencias: uniqueWarnings(advertencias),
  }, totalFallasConfirmadas);

  const restauracionCalendario = buildEmptyMetric({
    valorPromedioMinutos: null,
    sumaMinutos: sumaCalendario,
    fallasUsadas: fallasCalendarioUsadas,
    estado: "SIN_DATOS" as MTTRResult["estado"],
    advertencias: uniqueWarnings(advertencias),
  }, totalFallasConfirmadas);

  return {
    mttr,
    tiempoRespuesta,
    restauracionCalendario,
    detalles,
  };
}

export const calcularMTTR = calcularMetricasTecnicasFallas;
