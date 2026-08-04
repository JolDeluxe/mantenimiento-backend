import { describe, it, expect } from "bun:test";
import { calcularMTBF } from "../calculations/mtbf";

describe("MTBF - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-10T00:00:00-06:00");

  it("debe calcular el MTBF con restauración anterior al periodo y falla siguiente dentro", () => {
    const fallas = [
      {
        id: 1,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-07-28T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-07-30T10:00:00-06:00"), // Restaurada antes de 'desde'
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 2,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"), // Siguiente dentro
        fechaRestauracion: new Date("2026-08-04T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
    ];

    const res = calcularMTBF(fallas, [1], desde, hastaEfectivo);
    // Intervalo: 30 Jul a 3 Ago = 4 días = 5760 minutos
    expect(res.intervalosValidos).toBe(1);
    expect(res.sumaMinutosIntervalos).toBe(5760);
    expect(res.valorDias).toBe(4);
    expect(res.estado).toBe("CALCULABLE");
  });

  it("debe rechazar intervalos negativos o solapados", () => {
    const fallas = [
      {
        id: 1,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-05T10:00:00-06:00"), // Restauración posterior a la siguiente confirmación
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 2,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-08-04T10:00:00-06:00"), // Solapado
        fechaRestauracion: new Date("2026-08-06T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
    ];

    const res = calcularMTBF(fallas, [1], desde, hastaEfectivo);
    expect(res.intervalosValidos).toBe(0);
    expect(res.intervalosInvalidos).toBe(1);
    expect(res.estado).toBe("MUESTRA_INSUFICIENTE");
    expect(res.advertencias).toContain("INTERVALOS_MTBF_SUPERPUESTOS");
  });

  it("debe separar el cálculo entre diferentes máquinas de forma correcta", () => {
    const fallas = [
      {
        id: 1,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-08-01T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-02T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 2,
        maquinaId: 1,
        fechaFallaConfirmada: new Date("2026-08-04T10:00:00-06:00"), // Intervalo máquina 1 = 2 días (2880 min)
        fechaRestauracion: new Date("2026-08-05T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 3,
        maquinaId: 2,
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-03T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
      {
        id: 4,
        maquinaId: 2,
        fechaFallaConfirmada: new Date("2026-08-06T10:00:00-06:00"), // Intervalo máquina 2 = 3 días (4320 min)
        fechaRestauracion: new Date("2026-08-07T10:00:00-06:00"),
        estado: "REHABILITADA",
        contabilizaComoFalla: true,
      },
    ];

    const res = calcularMTBF(fallas, [1, 2], desde, hastaEfectivo);
    // Intervalos totales: 1 de 2 días y 1 de 3 días = 5 días = 7200 min / 2 = 2.5 días
    expect(res.intervalosValidos).toBe(2);
    expect(res.sumaMinutosIntervalos).toBe(7200);
    expect(res.valorDias).toBe(2.5);
  });
});
