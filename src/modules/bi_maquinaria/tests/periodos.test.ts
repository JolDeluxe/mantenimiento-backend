import { describe, it, expect } from "bun:test";
import { validarYCalcularPeriodo, calcularMinutosObservadosMaquina } from "../calculations/periodos";

describe("Periodos de BI - Cálculos puros", () => {
  const ahora = new Date("2026-08-05T12:00:00-06:00");

  it("debe validar desde inclusivo y hasta exclusivo con offset correcto", () => {
    const res = validarYCalcularPeriodo({
      desdeStr: "2026-08-01T00:00:00-06:00",
      hastaStr: "2026-08-05T00:00:00-06:00",
      ahora,
    });
    expect(res.desde.getTime()).toBe(new Date("2026-08-01T00:00:00-06:00").getTime());
    expect(res.hasta.getTime()).toBe(new Date("2026-08-05T00:00:00-06:00").getTime());
    expect(res.hastaEfectivo.getTime()).toBe(new Date("2026-08-05T00:00:00-06:00").getTime());
    expect(res.periodoRecortadoAHoy).toBe(false);
  });

  it("debe recortar hastaEfectivo si hasta es futuro", () => {
    const res = validarYCalcularPeriodo({
      desdeStr: "2026-08-01T00:00:00-06:00",
      hastaStr: "2026-08-10T00:00:00-06:00", // Futuro
      ahora,
    });
    expect(res.hastaEfectivo.getTime()).toBe(ahora.getTime());
    expect(res.periodoRecortadoAHoy).toBe(true);
  });

  it("debe lanzar error si desde no tiene offset", () => {
    expect(() =>
      validarYCalcularPeriodo({
        desdeStr: "2026-08-01T00:00:00", // Sin offset
        hastaStr: "2026-08-05T00:00:00-06:00",
        ahora,
      })
    ).toThrow();
  });

  it("debe lanzar error si hasta no tiene offset", () => {
    expect(() =>
      validarYCalcularPeriodo({
        desdeStr: "2026-08-01T00:00:00-06:00",
        hastaStr: "2026-08-05T00:00:00", // Sin offset
        ahora,
      })
    ).toThrow();
  });

  it("debe lanzar error si desde >= hasta", () => {
    expect(() =>
      validarYCalcularPeriodo({
        desdeStr: "2026-08-05T00:00:00-06:00",
        hastaStr: "2026-08-01T00:00:00-06:00",
        ahora,
      })
    ).toThrow();
  });

  it("debe calcular minutos observados de máquina considerando fecha de creación", () => {
    const desde = new Date("2026-08-01T00:00:00-06:00");
    const hastaEfectivo = new Date("2026-08-02T00:00:00-06:00"); // 1 día (1440 min)

    // Máquina creada antes del periodo
    const m1 = calcularMinutosObservadosMaquina({
      maquinaCreatedAt: new Date("2026-07-20T00:00:00-06:00"),
      desde,
      hastaEfectivo,
    });
    expect(m1).toBe(1440);

    // Máquina creada a mitad del periodo
    const m2 = calcularMinutosObservadosMaquina({
      maquinaCreatedAt: new Date("2026-08-01T12:00:00-06:00"), // A las 12 horas del primer día
      desde,
      hastaEfectivo,
    });
    expect(m2).toBe(720); // 12 horas (720 min)

    // Máquina creada después del periodo
    const m3 = calcularMinutosObservadosMaquina({
      maquinaCreatedAt: new Date("2026-08-03T00:00:00-06:00"),
      desde,
      hastaEfectivo,
    });
    expect(m3).toBe(0);
  });
});
