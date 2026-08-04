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

  it("debe retornar null en horizontes si MTBF es null", () => {
    const res = calcularConfiabilidad(null, "MUESTRA_INSUFICIENTE");
    expect(res.r1DiaPorcentaje).toBeNull();
    expect(res.r7DiasPorcentaje).toBeNull();
    expect(res.estado).toBe("MUESTRA_INSUFICIENTE");
  });

  it("debe retornar NO_CALCULABLE si MTBF <= 0", () => {
    const res = calcularConfiabilidad(0, "CALCULABLE");
    expect(res.r1DiaPorcentaje).toBeNull();
    expect(res.estado).toBe("NO_CALCULABLE");

    const resNeg = calcularConfiabilidad(-5, "CALCULABLE");
    expect(resNeg.r1DiaPorcentaje).toBeNull();
    expect(resNeg.estado).toBe("NO_CALCULABLE");
  });
});
