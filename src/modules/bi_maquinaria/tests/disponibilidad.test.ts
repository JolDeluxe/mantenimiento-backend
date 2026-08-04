import { describe, it, expect } from "bun:test";
import { calcularDisponibilidadMaquina } from "../calculations/disponibilidad";

describe("Disponibilidad - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-02T00:00:00-06:00"); // 1 día (1440 min)
  const maquinaCreatedAt = new Date("2026-07-20T00:00:00-06:00");

  it("debe retornar 100% de disponibilidad sin intervalos de paro", () => {
    const res = calcularDisponibilidadMaquina([], 1440, desde, hastaEfectivo, maquinaCreatedAt);
    expect(res.valorPorcentaje).toBe(100);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe restar correctamente un paro total", () => {
    const paros = [
      {
        id: 1,
        maquinaId: 1,
        tipo: "NO_PLANIFICADO",
        impacto: "PARO_TOTAL",
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"), // 2 horas = 120 min
        calidadDato: "CONFIRMADO",
      },
    ];

    const res = calcularDisponibilidadMaquina(paros, 1440, desde, hastaEfectivo, maquinaCreatedAt);
    // (1440 - 120) / 1440 * 100 = 91.6666...
    expect(res.valorPorcentaje).toBeCloseTo(91.6666, 3);
    expect(res.minutosParoEquivalentes).toBe(120);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe restar proporcionalmente un paro parcial con porcentaje", () => {
    const paros = [
      {
        id: 1,
        maquinaId: 1,
        tipo: "NO_PLANIFICADO",
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: 50, // 50% de afectación
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"), // 120 min reales * 0.5 = 60 min equivalentes
        calidadDato: "CONFIRMADO",
      },
    ];

    const res = calcularDisponibilidadMaquina(paros, 1440, desde, hastaEfectivo, maquinaCreatedAt);
    // (1440 - 60) / 1440 * 100 = 95.8333...
    expect(res.valorPorcentaje).toBeCloseTo(95.8333, 3);
    expect(res.minutosParoEquivalentes).toBe(60);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe retornar DATO_INCOMPLETO y valorPorcentaje null si hay paro parcial sin porcentaje", () => {
    const paros = [
      {
        id: 1,
        maquinaId: 1,
        tipo: "NO_PLANIFICADO",
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: null, // Sin porcentaje
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"), // 120 min
        calidadDato: "DATO_INCOMPLETO",
      },
    ];

    const res = calcularDisponibilidadMaquina(paros, 1440, desde, hastaEfectivo, maquinaCreatedAt);
    expect(res.valorPorcentaje).toBeNull();
    expect(res.minutosParoEquivalentes).toBe(0);
    expect(res.minutosParcialesSinPorcentaje).toBe(120);
    expect(res.disponibilidadConDatosConocidosPorcentaje).toBe(100); // Excluyendo el incompleto
    expect(res.estado).toBe("DATO_INCOMPLETO");
  });

  it("debe excluir paros planificados (preventivos) y reportarlos como auxiliar", () => {
    const paros = [
      {
        id: 1,
        maquinaId: 1,
        tipo: "PLANIFICADO",
        impacto: "PARO_TOTAL",
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"), // 120 min
        calidadDato: "CONFIRMADO",
      },
    ];

    const res = calcularDisponibilidadMaquina(paros, 1440, desde, hastaEfectivo, maquinaCreatedAt);
    expect(res.valorPorcentaje).toBe(100); // Excluido
    expect(res.minutosParoPlanificado).toBe(120);
  });

  it("debe reportar NO_CALCULABLE si existen intervalos superpuestos en la misma máquina", () => {
    const paros = [
      {
        id: 1,
        maquinaId: 1,
        tipo: "NO_PLANIFICADO",
        impacto: "PARO_TOTAL",
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
        calidadDato: "CONFIRMADO",
      },
      {
        id: 2,
        maquinaId: 1,
        tipo: "NO_PLANIFICADO",
        impacto: "PARO_TOTAL",
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T11:00:00-06:00"), // Solapado
        fin: new Date("2026-08-01T13:00:00-06:00"),
        calidadDato: "CONFIRMADO",
      },
    ];

    const res = calcularDisponibilidadMaquina(paros, 1440, desde, hastaEfectivo, maquinaCreatedAt);
    expect(res.valorPorcentaje).toBeNull();
    expect(res.estado).toBe("NO_CALCULABLE");
    expect(res.advertencias).toContain("INTERVALOS_PARO_SUPERPUESTOS");
  });
});
