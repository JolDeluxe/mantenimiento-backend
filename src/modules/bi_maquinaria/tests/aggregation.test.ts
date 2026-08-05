import { describe, it, expect } from "bun:test";
import { agregarMetricasGrupo } from "../calculations/aggregation";

describe("Agregación de Grupo - Cálculos puros", () => {
  it("debe sumar las bases analíticas de cada máquina antes de calcular los promedios e indicadores grupales", () => {
    const maquinasMetricas = [
      {
        minutosObservados: 1440,
        frecuencia: {
          valor: 1,
          fallasConfirmadas: 1,
          fallasAbiertas: 0,
          fallasRestauradas: 1,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        mttr: {
          valorMinutos: 60, // 60 min
          sumaMinutosTrabajoTecnico: 60,
          sumaMinutosRestauracion: 60,
          fallasRestauradasUsadas: 1,
          fallasAbiertasExcluidas: 0,
          fallasInvalidasExcluidas: 0,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        tiempoRespuesta: {
          valorPromedioMinutos: 10,
          sumaMinutos: 10,
          fallasUsadas: 1,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        restauracionCalendario: {
          valorPromedioMinutos: 120,
          sumaMinutos: 120,
          fallasUsadas: 1,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        mtbf: {
          valorDias: 2, // 2 días = 2880 min
          valorMinutos: 2880,
          sumaMinutosIntervalos: 2880,
          intervalosValidos: 1,
          intervalosInvalidos: 0,
          maquinasConIntervalos: 1,
          frecuenciaBase: 1,
          minutosOperativosProgramados: 1320,
          censurado: false,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        disponibilidad: {
          valorPorcentaje: 91.666, // 120 min de paro
          disponibilidadConDatosConocidosPorcentaje: 91.666,
          minutosProgramados: 1440,
          minutosParoEquivalentes: 120,
          minutosParcialesSinPorcentaje: 0,
          minutosParoPlanificado: 0,
          intervalosAbiertos: 0,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        confiabilidad: {
          r1DiaPorcentaje: 90,
          r7DiasPorcentaje: 50,
          r30DiasPorcentaje: 5,
          r90DiasPorcentaje: 0,
          mtbfBaseDias: 2,
          modelo: "EXPONENCIAL" as const,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
      },
      {
        minutosObservados: 1440,
        frecuencia: {
          valor: 2,
          fallasConfirmadas: 2,
          fallasAbiertas: 0,
          fallasRestauradas: 2,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        mttr: {
          valorMinutos: 120, // total 240 min para 2 fallas
          sumaMinutosTrabajoTecnico: 240,
          sumaMinutosRestauracion: 240,
          fallasRestauradasUsadas: 2,
          fallasAbiertasExcluidas: 0,
          fallasInvalidasExcluidas: 0,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        tiempoRespuesta: {
          valorPromedioMinutos: 20,
          sumaMinutos: 40,
          fallasUsadas: 2,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        restauracionCalendario: {
          valorPromedioMinutos: 300,
          sumaMinutos: 600,
          fallasUsadas: 2,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        mtbf: {
          valorDias: 3, // total 4320 min para 1 intervalo
          valorMinutos: 4320,
          sumaMinutosIntervalos: 4320,
          intervalosValidos: 1,
          intervalosInvalidos: 0,
          maquinasConIntervalos: 1,
          frecuenciaBase: 2,
          minutosOperativosProgramados: 1200,
          censurado: false,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        disponibilidad: {
          valorPorcentaje: 83.333, // 240 min de paro
          disponibilidadConDatosConocidosPorcentaje: 83.333,
          minutosProgramados: 1440,
          minutosParoEquivalentes: 240,
          minutosParcialesSinPorcentaje: 0,
          minutosParoPlanificado: 0,
          intervalosAbiertos: 0,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
        confiabilidad: {
          r1DiaPorcentaje: 90,
          r7DiasPorcentaje: 50,
          r30DiasPorcentaje: 5,
          r90DiasPorcentaje: 0,
          mtbfBaseDias: 3,
          modelo: "EXPONENCIAL" as const,
          estado: "CALCULABLE" as const,
          advertencias: [],
        },
      },
    ];

    const res = agregarMetricasGrupo(maquinasMetricas);

    // Frecuencia Total: 1 + 2 = 3
    expect(res.frecuencia.valor).toBe(3);

    // MTTR Grupal: (60 + 240) / (1 + 2) = 300 / 3 = 100 min
    expect(res.mttr.valorMinutos).toBe(100);
    expect(res.mttr.sumaMinutosRestauracion).toBe(300);
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(300);
    expect(res.tiempoRespuesta.valorPromedioMinutos).toBeCloseTo(50 / 3);
    expect(res.restauracionCalendario.valorPromedioMinutos).toBe(240);

    // MTBF Grupal programado: ((1440 + 1440) - (120 + 240)) / 3 / 540.
    expect(res.mtbf.valorDias).toBeCloseTo(2520 / 3 / 540);
    expect(res.mtbf.sumaMinutosIntervalos).toBe(2520);

    // Disponibilidad Grupal: bases de dos máquinas con paro equivalente total de 120 + 240 min.
    expect(res.disponibilidad.valorPorcentaje).toBe(87.5);
    expect(res.disponibilidad.minutosMaquinaObservados).toBe(2880);
    expect(res.disponibilidad.minutosProgramados).toBe(2880);
  });
});
