import { describe, it, expect } from "bun:test";
import { calcularMTBF } from "../calculations/mtbf";

describe("MTBF programado - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-10T00:00:00-06:00");

  const falla = (overrides: Partial<any> = {}) => ({
    id: 1,
    maquinaId: 1,
    fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"),
    fechaRestauracion: new Date("2026-08-03T11:00:00-06:00"),
    estado: "REHABILITADA",
    contabilizaComoFalla: true,
    ...overrides,
  });

  it("calcula MTBF como minutos operativos programados entre frecuencia y 540", () => {
    const res = calcularMTBF(
      [falla()],
      [1],
      desde,
      hastaEfectivo,
      5400,
      0,
    );

    expect(res.frecuenciaBase).toBe(1);
    expect(res.minutosOperativosProgramados).toBe(5400);
    expect(res.valorMinutos).toBe(5400);
    expect(res.valorDias).toBe(10);
    expect(res.censurado).toBe(false);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("descuenta paros no planificados equivalentes, no tiempo técnico", () => {
    const res = calcularMTBF(
      [falla()],
      [1],
      desde,
      hastaEfectivo,
      1980,
      183.48511666666667,
    );

    expect(res.frecuenciaBase).toBe(1);
    expect(res.minutosOperativosProgramados).toBeCloseTo(1796.5148833333333);
    expect(res.valorDias).toBeCloseTo(1796.5148833333333 / 540);
  });

  it("si no hay fallas, devuelve el periodo observado como censurado", () => {
    const res = calcularMTBF([], [1], desde, hastaEfectivo, 1980, 0);

    expect(res.frecuenciaBase).toBe(0);
    expect(res.valorMinutos).toBe(1980);
    expect(res.valorDias).toBeCloseTo(1980 / 540);
    expect(res.censurado).toBe(true);
    expect(res.advertencias).toContain("MTBF_CENSURADO_SIN_FALLAS");
  });

  it("excluye fallas fuera del periodo y queda censurado", () => {
    const res = calcularMTBF(
      [falla({ fechaFallaConfirmada: new Date("2026-07-20T10:00:00-06:00") })],
      [1],
      desde,
      hastaEfectivo,
      540,
      0,
    );

    expect(res.frecuenciaBase).toBe(0);
    expect(res.valorDias).toBe(1);
    expect(res.censurado).toBe(true);
  });
});
