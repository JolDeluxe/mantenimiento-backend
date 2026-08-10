import { describe, expect, it } from "bun:test";
import { calcularPeriodo } from "../calculations/periodos";

describe("Periodos de Días Laborados", () => {
  it("calcula Semana 32 de 2026 como lunes 03 a domingo 09 de agosto", () => {
    const periodo = calcularPeriodo({
      periodo: "SEMANA",
      anio: 2026,
      semana: 32,
    });

    expect(periodo.desdeFecha).toBe("2026-08-03");
    expect(periodo.hastaFecha).toBe("2026-08-09");
    expect(periodo.desde.toISOString()).toBe("2026-08-03T06:00:00.000Z");
    expect(periodo.hastaExclusivo.toISOString()).toBe("2026-08-10T06:00:00.000Z");
  });
});
