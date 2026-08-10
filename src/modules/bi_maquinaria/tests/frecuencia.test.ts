import { describe, it, expect } from "bun:test";
import { calcularFrecuencia } from "../calculations/frecuencia";

describe("Frecuencia de fallas - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-05T00:00:00-06:00");

  it("debe retornar cero fallas si la lista está vacía", () => {
    const res = calcularFrecuencia([], desde, hastaEfectivo);
    expect(res.valor).toBe(0);
    expect(res.estado).toBe("SIN_DATOS");
  });

  it("debe contar fallas confirmadas correctas", () => {
    const fallas = [
      {
        id: 1,
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        calidadDato: "CONFIRMADO",
      },
      {
        id: 2,
        estado: "ABIERTA",
        contabilizaComoFalla: true,
        fechaFallaConfirmada: new Date("2026-08-03T15:00:00-06:00"),
        calidadDato: "CONFIRMADO",
      },
    ];
    const res = calcularFrecuencia(fallas, desde, hastaEfectivo);
    expect(res.valor).toBe(2);
    expect(res.fallasConfirmadas).toBe(2);
    expect(res.fallasAbiertas).toBe(1);
    expect(res.fallasRestauradas).toBe(1);
    expect(res.estado).toBe("CALCULABLE");
    expect(res.advertencias).toContain("FALLAS_ABIERTAS_EXCLUIDAS_MTTR");
  });

  it("debe excluir fallas no confirmadas o descartadas o provisionales", () => {
    const fallas = [
      {
        id: 1,
        estado: "DESCARTADA",
        contabilizaComoFalla: false,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        calidadDato: "CONFIRMADO",
      },
      {
        id: 2,
        estado: "PENDIENTE_DE_DIAGNOSTICO",
        contabilizaComoFalla: true,
        fechaFallaConfirmada: null, // provisional
        calidadDato: "PROVISIONAL",
      },
    ];
    const res = calcularFrecuencia(fallas, desde, hastaEfectivo);
    expect(res.valor).toBe(0);
    expect(res.estado).toBe("SIN_DATOS");
  });

  it("debe validar límites estrictos [desde, hastaEfectivo)", () => {
    const fallas = [
      {
        id: 1,
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
        fechaFallaConfirmada: new Date("2026-08-01T00:00:00-06:00"), // límite desde
        calidadDato: "CONFIRMADO",
      },
      {
        id: 2,
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
        fechaFallaConfirmada: new Date("2026-08-05T00:00:00-06:00"), // límite hasta (excluido)
        calidadDato: "CONFIRMADO",
      },
    ];
    const res = calcularFrecuencia(fallas, desde, hastaEfectivo);
    expect(res.valor).toBe(1);
    expect(res.fallasConfirmadas).toBe(1);
  });
});
