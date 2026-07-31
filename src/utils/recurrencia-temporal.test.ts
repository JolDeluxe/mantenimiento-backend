import { describe, expect, test } from "bun:test";
import { UnidadRecurrenciaActividad } from "@prisma/client";
import {
  esCicloOperativoDelPatron,
  esCicloDelPatron,
  fechaHoraMexico,
  generarCiclosOperativosEnRango,
  generarCiclosEnRango,
  minutosDesdeHora,
  siguienteCicloOperativo,
} from "./recurrencia-temporal";

const monthly = {
  fechaInicio: new Date(Date.UTC(2025, 0, 31)),
  unidad: UnidadRecurrenciaActividad.MES,
  intervalo: 1,
};

describe("recurrencia temporal de actividades", () => {
  test("preserva el ancla mensual tras febrero", () => {
    const cycles = generarCiclosEnRango(monthly, new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2025, 4, 31)));
    expect(cycles.map((cycle) => cycle.toISOString().slice(0, 10))).toEqual([
      "2025-01-31", "2025-02-28", "2025-03-31", "2025-04-30", "2025-05-31",
    ]);
  });

  test("soporta febrero bisiesto y cambios de año", () => {
    const cycles = generarCiclosEnRango(
      { ...monthly, fechaInicio: new Date(Date.UTC(2023, 11, 31)) },
      new Date(Date.UTC(2023, 11, 1)),
      new Date(Date.UTC(2024, 2, 31)),
    );
    expect(cycles.map((cycle) => cycle.toISOString().slice(0, 10))).toEqual([
      "2023-12-31", "2024-01-31", "2024-02-29", "2024-03-31",
    ]);
  });

  test("calcula bimestral, trimestral y respeta fecha final", () => {
    const bimestral = generarCiclosEnRango(
      { fechaInicio: new Date(Date.UTC(2026, 0, 30)), fechaFin: new Date(Date.UTC(2026, 6, 30)), unidad: UnidadRecurrenciaActividad.MES, intervalo: 2 },
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 11, 31)),
    );
    expect(bimestral.map((cycle) => cycle.toISOString().slice(0, 10))).toEqual(["2026-01-30", "2026-03-30", "2026-05-30", "2026-07-30"]);
    const trimestral = generarCiclosEnRango(
      { fechaInicio: new Date(Date.UTC(2026, 0, 29)), unidad: UnidadRecurrenciaActividad.MES, intervalo: 3 },
      new Date(Date.UTC(2026, 0, 1)),
      new Date(Date.UTC(2026, 9, 31)),
    );
    expect(trimestral.map((cycle) => cycle.toISOString().slice(0, 10))).toEqual(["2026-01-29", "2026-04-29", "2026-07-29", "2026-10-29"]);
  });

  test("valida ciclos diarios, semanales y quincenales", () => {
    const start = new Date(Date.UTC(2026, 0, 1));
    expect(esCicloDelPatron({ fechaInicio: start, unidad: UnidadRecurrenciaActividad.DIA, intervalo: 2 }, "2026-01-03")).toBe(true);
    expect(esCicloDelPatron({ fechaInicio: start, unidad: UnidadRecurrenciaActividad.SEMANA, intervalo: 1 }, "2026-01-08")).toBe(true);
    expect(esCicloDelPatron({ fechaInicio: start, unidad: UnidadRecurrenciaActividad.SEMANA, intervalo: 2 }, "2026-01-08")).toBe(false);
  });

  test("los ciclos operativos excluyen domingos", () => {
    const patron = { fechaInicio: new Date(Date.UTC(2026, 6, 30)), unidad: UnidadRecurrenciaActividad.DIA, intervalo: 1 };
    const cycles = generarCiclosOperativosEnRango(patron, new Date(Date.UTC(2026, 6, 30)), new Date(Date.UTC(2026, 7, 3)));
    expect(cycles.map((cycle) => cycle.toISOString().slice(0, 10))).toEqual(["2026-07-30", "2026-07-31", "2026-08-01", "2026-08-03"]);
    expect(esCicloOperativoDelPatron(patron, "2026-08-02")).toBe(false);
    expect(siguienteCicloOperativo(patron, new Date(Date.UTC(2026, 7, 1))).toISOString().slice(0, 10)).toBe("2026-08-03");
  });

  test("convierte horario de México y valida HH:mm", () => {
    expect(minutosDesdeHora("08:30")).toBe(510);
    expect(() => minutosDesdeHora("24:00")).toThrow();
    const instant = fechaHoraMexico("2026-01-15", 510);
    expect(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(instant)).toBe("08:30");
  });
});
