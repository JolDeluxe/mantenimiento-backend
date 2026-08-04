import { describe, it, expect } from "bun:test";
import { calcularMTTR } from "../calculations/mttr";

describe("MTTR de fallas - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-05T00:00:00-06:00");

  it("debe retornar SIN_DATOS si no hay fallas confirmadas", () => {
    const res = calcularMTTR([], desde, hastaEfectivo);
    expect(res.valorMinutos).toBeNull();
    expect(res.estado).toBe("SIN_DATOS");
  });

  it("debe calcular el MTTR con restauradas correctas", () => {
    const fallas = [
      {
        id: 1,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-02T11:00:00-06:00"), // 60 min
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 2,
        fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-03T12:00:00-06:00"), // 120 min
        estado: "CERRADO",
        contabilizaComoFalla: true,
      },
    ];
    const res = calcularMTTR(fallas, desde, hastaEfectivo);
    expect(res.valorMinutos).toBe(90); // (60 + 120) / 2
    expect(res.sumaMinutosRestauracion).toBe(180);
    expect(res.fallasRestauradasUsadas).toBe(2);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe ignorar fallas abiertas en el cálculo de MTTR y no causar división por cero", () => {
    const fallas = [
      {
        id: 1,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: null, // abierta
        estado: "ABIERTA",
        contabilizaComoFalla: true,
      },
    ];
    const res = calcularMTTR(fallas, desde, hastaEfectivo);
    expect(res.valorMinutos).toBeNull();
    expect(res.fallasRestauradasUsadas).toBe(0);
    expect(res.fallasAbiertasExcluidas).toBe(1);
    expect(res.estado).toBe("MUESTRA_INSUFICIENTE");
    expect(res.advertencias).toContain("FALLAS_RESTAURADAS_INSUFICIENTES");
  });

  it("debe detectar y registrar restauraciones con fechas inválidas (negativas)", () => {
    const fallas = [
      {
        id: 1,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-02T09:00:00-06:00"), // Antes de iniciar
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
    ];
    const res = calcularMTTR(fallas, desde, hastaEfectivo);
    expect(res.valorMinutos).toBeNull();
    expect(res.fallasInvalidasExcluidas).toBe(1);
    expect(res.estado).toBe("MUESTRA_INSUFICIENTE");
    expect(res.advertencias).toContain("FECHA_RESTAURACION_INVALIDA");
  });
});
