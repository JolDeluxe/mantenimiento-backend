/**
 * bi_maquinaria/calculations/disponibilidad.ts
 *
 * Funciones puras para el cálculo de disponibilidad técnica observada en tiempo calendario.
 */

export interface ParoInput {
  id: number;
  maquinaId: number;
  tipo: string; // "NO_PLANIFICADO" | "PLANIFICADO"
  impacto: string; // "PARO_TOTAL" | "PARO_PARCIAL" | "SIN_PARO"
  porcentajeAfectacion: number | null;
  inicio: Date;
  fin: Date | null;
  calidadDato: string;
}

export interface DisponibilidadResult {
  valorPorcentaje: number | null;
  disponibilidadConDatosConocidosPorcentaje: number | null;
  minutosMaquinaObservados: number;
  minutosProgramados: number;
  minutosParoEquivalentes: number;
  minutosParcialesSinPorcentaje: number;
  minutosParoPlanificado: number;
  intervalosAbiertos: number;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

type ParoEfectivo = ParoInput & {
  inicioEfectivo: Date;
  finEfectivo: Date;
  duracionEfectiva: number;
};

const minutesBetween = (inicio: Date, fin: Date) =>
  Math.max(0, (fin.getTime() - inicio.getTime()) / 60000);

export function calcularDisponibilidadMaquina(
  paros: ParoInput[],
  minutosObservados: number,
  desde: Date,
  hastaEfectivo: Date,
  maquinaCreatedAt: Date
): Omit<DisponibilidadResult, "minutosMaquinaObservados"> {
  const advertencias = new Set<string>();
  let minutosParcialesSinPorcentaje = 0;
  let minutosPlanificados = 0;
  let intervalosAbiertos = 0;
  let tieneIncompleto = false;
  let tieneErrores = false;
  let tieneParcialesAmbiguos = false;

  // Filtrar e intersectar intervalos de paros
  const parosEfectivos = paros
    .map((p) => {
      const inicioObservacion = maquinaCreatedAt.getTime() > desde.getTime()
        ? maquinaCreatedAt
        : desde;

      const inicioEfectivo = new Date(Math.max(p.inicio.getTime(), desde.getTime(), inicioObservacion.getTime()));

      const finReal = p.fin ? p.fin : hastaEfectivo;
      if (!p.fin) {
        intervalosAbiertos++;
        advertencias.add("PARO_ABIERTO");
      }

      const finEfectivo = new Date(Math.min(finReal.getTime(), hastaEfectivo.getTime()));
      const duracionEfectiva = minutesBetween(inicioEfectivo, finEfectivo);

      // Validaciones básicas
      if (p.fin && p.fin <= p.inicio) {
        tieneErrores = true;
        advertencias.add("FECHA_PARO_INVALIDA");
      }
      if (p.inicio.getTime() < maquinaCreatedAt.getTime()) {
        tieneErrores = true;
        advertencias.add("FECHA_PARO_INVALIDA");
      }

      return {
        ...p,
        inicioEfectivo,
        finEfectivo,
        duracionEfectiva,
      };
    })
    .filter((p) => p.duracionEfectiva > 0);

  // Separar planificados de no planificados
  const noPlanificados = parosEfectivos.filter((p) => p.tipo === "NO_PLANIFICADO");
  const planificados = parosEfectivos.filter((p) => p.tipo === "PLANIFICADO");

  // Sumar planificados
  for (const p of planificados) {
    minutosPlanificados += p.duracionEfectiva;
  }

  // Calcular minutos equivalentes con unión temporal por segmentos.
  // PARO_TOTAL domina cualquier parcial superpuesto; paros totales superpuestos
  // se fusionan y no anulan la disponibilidad.
  let minutosEquivalentesConocidos = 0;
  const boundaries = Array.from(new Set(
    noPlanificados.flatMap((p) => [p.inicioEfectivo.getTime(), p.finEfectivo.getTime()])
  )).sort((a, b) => a - b);

  for (let i = 0; i < boundaries.length - 1; i++) {
    const inicioMs = boundaries[i]!;
    const finMs = boundaries[i + 1]!;
    if (finMs <= inicioMs) continue;

    const activos = (noPlanificados as ParoEfectivo[]).filter(
      (p) => p.inicioEfectivo.getTime() <= inicioMs && p.finEfectivo.getTime() >= finMs
    );
    if (activos.length === 0) continue;

    const duracionSegmento = (finMs - inicioMs) / 60000;
    if (duracionSegmento <= 0) continue;

    const totales = activos.filter((p) => p.impacto === "PARO_TOTAL");
    if (totales.length > 0) {
      for (const p of totales) {
        if (p.porcentajeAfectacion !== null && p.porcentajeAfectacion !== 100) {
          tieneErrores = true;
          advertencias.add("FECHA_PARO_INVALIDA");
        }
      }
      if (activos.length > 1) {
        advertencias.add("INTERVALOS_PARO_FUSIONADOS");
      }
      minutosEquivalentesConocidos += duracionSegmento;
      continue;
    }

    const parciales = activos.filter((p) => p.impacto === "PARO_PARCIAL");
    if (parciales.length === 0) continue;

    const conPorcentaje = parciales.filter((p) => p.porcentajeAfectacion !== null);
    const sinPorcentaje = parciales.filter((p) => p.porcentajeAfectacion === null);

    if (sinPorcentaje.length > 0) {
      tieneIncompleto = true;
      minutosParcialesSinPorcentaje += duracionSegmento;
      advertencias.add("PARO_PARCIAL_SIN_PORCENTAJE");
      continue;
    }

    const porcentajes = new Set<number>();
    for (const p of conPorcentaje) {
      const porcentaje = p.porcentajeAfectacion;
      if (porcentaje === null || porcentaje < 1 || porcentaje > 99) {
        tieneErrores = true;
        advertencias.add("FECHA_PARO_INVALIDA");
        continue;
      }
      porcentajes.add(porcentaje);
    }

    if (porcentajes.size === 0) continue;
    if (porcentajes.size > 1) {
      tieneParcialesAmbiguos = true;
      advertencias.add("PAROS_PARCIALES_SUPERPUESTOS_AMBIGUOS");
      continue;
    }

    if (conPorcentaje.length > 1) {
      advertencias.add("INTERVALOS_PARO_FUSIONADOS");
    }
    const porcentaje = Array.from(porcentajes)[0]!;
    minutosEquivalentesConocidos += duracionSegmento * (porcentaje / 100);
  }

  let valorPorcentaje: number | null = null;
  let disponibilidadConDatosConocidosPorcentaje: number | null = null;
  let estado: DisponibilidadResult["estado"] = "CALCULABLE";

  if (minutosObservados <= 0) {
    estado = "SIN_DATOS";
    valorPorcentaje = null;
    disponibilidadConDatosConocidosPorcentaje = null;
  } else if (tieneParcialesAmbiguos || tieneErrores) {
    estado = "NO_CALCULABLE";
    valorPorcentaje = null;
    disponibilidadConDatosConocidosPorcentaje = null;
  } else if (tieneIncompleto) {
    estado = "DATO_INCOMPLETO";
    valorPorcentaje = null;
    disponibilidadConDatosConocidosPorcentaje = Math.max(
      0,
      ((minutosObservados - minutosEquivalentesConocidos) / minutosObservados) * 100
    );
  } else {
    valorPorcentaje = Math.max(
      0,
      ((minutosObservados - minutosEquivalentesConocidos) / minutosObservados) * 100
    );
    disponibilidadConDatosConocidosPorcentaje = valorPorcentaje;
  }

  // Clampear a 100
  if (valorPorcentaje !== null && valorPorcentaje > 100) valorPorcentaje = 100;
  if (
    disponibilidadConDatosConocidosPorcentaje !== null &&
    disponibilidadConDatosConocidosPorcentaje > 100
  ) {
    disponibilidadConDatosConocidosPorcentaje = 100;
  }

  return {
      valorPorcentaje,
    disponibilidadConDatosConocidosPorcentaje,
    minutosProgramados: minutosObservados,
    minutosParoEquivalentes: minutosEquivalentesConocidos,
    minutosParcialesSinPorcentaje,
    minutosParoPlanificado: minutosPlanificados,
    intervalosAbiertos,
    estado,
    advertencias: Array.from(advertencias),
  };
}
