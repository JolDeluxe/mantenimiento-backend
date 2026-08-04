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
  minutosParoEquivalentes: number;
  minutosParcialesSinPorcentaje: number;
  minutosParoPlanificado: number;
  intervalosAbiertos: number;
  estado: "CALCULABLE" | "SIN_DATOS" | "MUESTRA_INSUFICIENTE" | "NO_CALCULABLE" | "DATO_INCOMPLETO";
  advertencias: string[];
}

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
  let tieneSuperposicion = false;
  let tieneErrores = false;

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
      const duracionEfectiva = Math.max(0, (finEfectivo.getTime() - inicioEfectivo.getTime()) / 60000);

      // Validaciones básicas
      if (p.fin && p.fin < p.inicio) {
        tieneErrores = true;
        advertencias.add("FECHA_PARO_INVALIDA");
      }
      if (p.inicio.getTime() < maquinaCreatedAt.getTime()) {
        tieneErrores = true;
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

  // Detectar solapamientos en no planificados
  const sortedNoPlan = [...noPlanificados].sort(
    (a, b) => a.inicioEfectivo.getTime() - b.inicioEfectivo.getTime()
  );

  for (let i = 1; i < sortedNoPlan.length; i++) {
    const prev = sortedNoPlan[i - 1];
    const curr = sortedNoPlan[i];
    if (!prev || !curr) continue;

    if (curr.inicioEfectivo.getTime() < prev.finEfectivo.getTime()) {
      tieneSuperposicion = true;
      advertencias.add("INTERVALOS_PARO_SUPERPUESTOS");
    }
  }

  // Calcular minutos de paros equivalentes
  let minutosEquivalentesConocidos = 0;

  for (const p of noPlanificados) {
    if (p.impacto === "PARO_TOTAL") {
      if (p.porcentajeAfectacion !== null && p.porcentajeAfectacion !== 100) {
        tieneErrores = true;
      }
      minutosEquivalentesConocidos += p.duracionEfectiva;
    } else if (p.impacto === "PARO_PARCIAL") {
      if (p.porcentajeAfectacion !== null) {
        if (p.porcentajeAfectacion < 1 || p.porcentajeAfectacion > 99) {
          tieneErrores = true;
        }
        const equivalentes = p.duracionEfectiva * (p.porcentajeAfectacion / 100);
        minutosEquivalentesConocidos += equivalentes;
      } else {
        tieneIncompleto = true;
        minutosParcialesSinPorcentaje += p.duracionEfectiva;
        advertencias.add("PARO_PARCIAL_SIN_PORCENTAJE");
      }
    }
  }

  let valorPorcentaje: number | null = null;
  let disponibilidadConDatosConocidosPorcentaje: number | null = null;
  let estado: DisponibilidadResult["estado"] = "CALCULABLE";

  if (minutosObservados <= 0) {
    estado = "SIN_DATOS";
    valorPorcentaje = null;
    disponibilidadConDatosConocidosPorcentaje = null;
  } else if (tieneSuperposicion || tieneErrores) {
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
    minutosParoEquivalentes: minutosEquivalentesConocidos,
    minutosParcialesSinPorcentaje,
    minutosParoPlanificado: minutosPlanificados,
    intervalosAbiertos,
    estado,
    advertencias: Array.from(advertencias),
  };
}
