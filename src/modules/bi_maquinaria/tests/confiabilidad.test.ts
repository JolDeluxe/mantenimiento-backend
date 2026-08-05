import { describe, it, expect } from "bun:test";
import { calcularConfiabilidad } from "../calculations/confiabilidad";

describe("Confiabilidad - Cálculos puros", () => {
  it("debe calcular correctamente los horizontes de 1, 7, 30 y 90 días con MTBF válido", () => {
    const res = calcularConfiabilidad(10, "CALCULABLE"); // MTBF = 10 días
    expect(res.mtbfBaseDias).toBe(10);
    // R(1) = exp(-1/10) * 100 = 90.4837...
    expect(res.r1DiaPorcentaje).toBeCloseTo(90.4837, 3);
    // R(7) = exp(-7/10) * 100 = 49.6585...
    expect(res.r7DiasPorcentaje).toBeCloseTo(49.6585, 3);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe retornar 100% si frecuencia es cero", () => {
    const res = calcularConfiabilidad(null, "CALCULABLE", 0);
    expect(res.r1DiaPorcentaje).toBe(100);
    expect(res.r7DiasPorcentaje).toBe(100);
    expect(res.r30DiasPorcentaje).toBe(100);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe retornar 0% sin null si hay frecuencia pero MTBF es inválido", () => {
    const res = calcularConfiabilidad(null, "MUESTRA_INSUFICIENTE", 1);
    expect(res.r1DiaPorcentaje).toBe(0);
    expect(res.r7DiasPorcentaje).toBe(0);
    expect(res.estado).toBe("MUESTRA_INSUFICIENTE");
  });

  it("debe retornar NO_CALCULABLE si MTBF <= 0", () => {
    const res = calcularConfiabilidad(0, "CALCULABLE");
    expect(res.r1DiaPorcentaje).toBe(0);
    expect(res.estado).toBe("NO_CALCULABLE");

    const resNeg = calcularConfiabilidad(-5, "CALCULABLE");
    expect(resNeg.r1DiaPorcentaje).toBe(0);
    expect(resNeg.estado).toBe("NO_CALCULABLE");
  });
});
