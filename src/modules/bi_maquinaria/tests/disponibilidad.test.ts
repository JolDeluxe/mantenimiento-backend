import { describe, it, expect } from "bun:test";
import { calcularDisponibilidadMaquina, type ParoInput } from "../calculations/disponibilidad";

describe("Disponibilidad - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-02T00:00:00-06:00");
  const maquinaCreatedAt = new Date("2026-07-20T00:00:00-06:00");

  const paro = (input: Partial<ParoInput> & { id: number; inicio: Date; fin?: Date | null }): ParoInput => ({
    maquinaId: 1,
    tipo: "NO_PLANIFICADO",
    impacto: "PARO_TOTAL",
    porcentajeAfectacion: 100,
    calidadDato: "CONFIRMADO",
    fin: input.fin ?? null,
    ...input,
  });

  const calcular = (paros: ParoInput[], minutos = 1440) =>
    calcularDisponibilidadMaquina(paros, minutos, desde, hastaEfectivo, maquinaCreatedAt);

  const expectFiniteNumbers = (value: unknown) => {
    if (typeof value === "number") {
      expect(Number.isNaN(value)).toBe(false);
      expect(Number.isFinite(value)).toBe(true);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(expectFiniteNumbers);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(expectFiniteNumbers);
    }
  };

  it("retorna 100% sin paros", () => {
    const res = calcular([]);
    expect(res.valorPorcentaje).toBe(100);
    expect(res.minutosParoEquivalentes).toBe(0);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("resta un PARO_TOTAL", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T10:00:00-06:00"), fin: new Date("2026-08-01T12:00:00-06:00") }),
    ]);
    expect(res.valorPorcentaje).toBeCloseTo(91.6666, 3);
    expect(res.minutosParoEquivalentes).toBe(120);
  });

  it("suma dos PARO_TOTAL no superpuestos", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T09:00:00-06:00") }),
      paro({ id: 2, inicio: new Date("2026-08-01T10:00:00-06:00"), fin: new Date("2026-08-01T12:00:00-06:00") }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(180);
    expect(res.valorPorcentaje).toBeCloseTo(87.5, 3);
  });

  it("fusiona dos PARO_TOTAL superpuestos", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
      paro({ id: 2, inicio: new Date("2026-08-01T09:00:00-06:00"), fin: new Date("2026-08-01T11:00:00-06:00") }),
    ]);
    expect(res.estado).toBe("CALCULABLE");
    expect(res.minutosParoEquivalentes).toBe(180);
    expect(res.valorPorcentaje).toBeCloseTo(87.5, 3);
    expect(res.advertencias).toContain("INTERVALOS_PARO_FUSIONADOS");
  });

  it("fusiona tres PARO_TOTAL encadenados", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
      paro({ id: 2, inicio: new Date("2026-08-01T09:30:00-06:00"), fin: new Date("2026-08-01T11:00:00-06:00") }),
      paro({ id: 3, inicio: new Date("2026-08-01T11:00:00-06:00"), fin: new Date("2026-08-01T12:00:00-06:00") }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(240);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("computa PARO_TOTAL abierto hasta hastaEfectivo", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T22:00:00-06:00"), fin: null }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(120);
    expect(res.intervalosAbiertos).toBe(1);
    expect(res.advertencias).toContain("PARO_ABIERTO");
  });

  it("PARO_TOTAL domina un PARO_PARCIAL superpuesto", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
      paro({
        id: 2,
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: 50,
        inicio: new Date("2026-08-01T09:00:00-06:00"),
        fin: new Date("2026-08-01T11:00:00-06:00"),
      }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(150);
    expect(res.estado).toBe("CALCULABLE");
    expect(res.advertencias).toContain("INTERVALOS_PARO_FUSIONADOS");
  });

  it("resta PARO_PARCIAL con porcentaje", () => {
    const res = calcular([
      paro({
        id: 1,
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: 50,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
      }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(60);
    expect(res.valorPorcentaje).toBeCloseTo(95.8333, 3);
  });

  it("PARO_PARCIAL sin porcentaje deja DATO_INCOMPLETO", () => {
    const res = calcular([
      paro({
        id: 1,
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: null,
        calidadDato: "DATO_INCOMPLETO",
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
      }),
    ]);
    expect(res.valorPorcentaje).toBeNull();
    expect(res.estado).toBe("DATO_INCOMPLETO");
    expect(res.minutosParcialesSinPorcentaje).toBe(120);
    expect(res.advertencias).toContain("PARO_PARCIAL_SIN_PORCENTAJE");
  });

  it("dos parciales superpuestos con porcentajes distintos son ambiguos", () => {
    const res = calcular([
      paro({
        id: 1,
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: 40,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
      }),
      paro({
        id: 2,
        impacto: "PARO_PARCIAL",
        porcentajeAfectacion: 60,
        inicio: new Date("2026-08-01T11:00:00-06:00"),
        fin: new Date("2026-08-01T13:00:00-06:00"),
      }),
    ]);
    expect(res.valorPorcentaje).toBeNull();
    expect(res.estado).toBe("NO_CALCULABLE");
    expect(res.advertencias).toContain("PAROS_PARCIALES_SUPERPUESTOS_AMBIGUOS");
  });

  it("duplicado del mismo fallaId se fusiona y no cuenta doble", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
      paro({ id: 2, inicio: new Date("2026-08-01T08:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(120);
    expect(res.advertencias).toContain("INTERVALOS_PARO_FUSIONADOS");
  });

  it("intervalo inválido no inventa duración", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T12:00:00-06:00"), fin: new Date("2026-08-01T10:00:00-06:00") }),
    ]);
    expect(res.valorPorcentaje).toBeNull();
    expect(res.estado).toBe("NO_CALCULABLE");
    expect(res.minutosParoEquivalentes).toBe(0);
    expect(res.advertencias).toContain("FECHA_PARO_INVALIDA");
  });

  it("recorta el paro al periodo solicitado", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-07-31T23:00:00-06:00"), fin: new Date("2026-08-01T01:00:00-06:00") }),
      paro({ id: 2, inicio: new Date("2026-08-01T23:00:00-06:00"), fin: new Date("2026-08-02T01:00:00-06:00") }),
    ]);
    expect(res.minutosParoEquivalentes).toBe(120);
  });

  it("excluye planificados sin reducir disponibilidad", () => {
    const res = calcular([
      paro({
        id: 1,
        tipo: "PLANIFICADO",
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
      }),
    ]);
    expect(res.valorPorcentaje).toBe(100);
    expect(res.minutosParoPlanificado).toBe(120);
  });

  it("disponibilidad se calcula aunque la falla que originó el paro siga abierta", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T22:00:00-06:00"), fin: null }),
    ]);
    expect(res.estado).toBe("CALCULABLE");
    expect(res.valorPorcentaje).toBeCloseTo(91.6666, 3);
  });

  it("no genera NaN", () => {
    const res = calcular([], 0);
    expectFiniteNumbers(res);
    expect(res.valorPorcentaje).toBeNull();
  });

  it("no genera Infinity", () => {
    const res = calcular([
      paro({ id: 1, inicio: new Date("2026-08-01T10:00:00-06:00"), fin: new Date("2026-08-01T11:00:00-06:00") }),
    ], 0);
    expectFiniteNumbers(res);
    expect(res.valorPorcentaje).toBeNull();
  });
});
