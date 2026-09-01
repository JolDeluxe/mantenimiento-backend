import { describe, expect, test } from "bun:test";
import { UnidadRecurrenciaActividad } from "@prisma/client";
import { resolverPoliticaMaterializacionActividad } from "./materialization-policy";

const fecha = (value: string) => new Date(`${value}T00:00:00.000Z`);

const regla = (overrides = {}) => ({
  fechaInicio: fecha("2026-08-20"),
  fechaFin: null,
  unidad: UnidadRecurrenciaActividad.DIA,
  intervalo: 1,
  proximaFechaEjecucion: fecha("2026-08-20"),
  ...overrides,
});

describe("política anti-backlog para actividades recurrentes", () => {
  test("diaria con ciclo hoy materializa hoy y calcula siguiente operativo", () => {
    const decision = resolverPoliticaMaterializacionActividad(
      regla({ fechaInicio: fecha("2026-09-01"), proximaFechaEjecucion: fecha("2026-09-01") }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("MATERIALIZAR_HOY");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-02T00:00:00.000Z");
  });

  test("diaria atrasada una semana descarta histórico y materializa máximo hoy", () => {
    const decision = resolverPoliticaMaterializacionActividad(regla(), fecha("2026-09-01"));

    expect(decision.motivo).toBe("MATERIALIZAR_HOY");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBeGreaterThan(0);
  });

  test("DIA pendiente 31 agosto y hoy 1 septiembre no crea 31, crea solo 1 si toca", () => {
    const decision = resolverPoliticaMaterializacionActividad(
      regla({ fechaInicio: fecha("2026-08-31"), proximaFechaEjecucion: fecha("2026-08-31") }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("MATERIALIZAR_HOY");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(1);
  });

  test("SEMANA pendiente al cerrar agosto se recupera como única deuda el 1 septiembre", () => {
    const decision = resolverPoliticaMaterializacionActividad(
      regla({
        fechaInicio: fecha("2026-08-17"),
        fechaFin: fecha("2026-08-31"),
        unidad: UnidadRecurrenciaActividad.SEMANA,
        proximaFechaEjecucion: fecha("2026-08-17"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("MATERIALIZAR_DEUDA");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(2);
  });

  test("MES pendiente 31 agosto se recupera el 1 septiembre conservando fechaCicloLogica", () => {
    const decision = resolverPoliticaMaterializacionActividad(
      regla({
        fechaInicio: fecha("2026-08-31"),
        unidad: UnidadRecurrenciaActividad.MES,
        proximaFechaEjecucion: fecha("2026-08-31"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("MATERIALIZAR_DEUDA");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });

  test("regla futura no genera ni mueve cursor", () => {
    const decision = resolverPoliticaMaterializacionActividad(
      regla({ fechaInicio: fecha("2026-09-10"), proximaFechaEjecucion: fecha("2026-09-10") }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("FUTURA");
    expect(decision.fechaCicloLogica).toBeNull();
    expect(decision.requiereActualizarCursor).toBe(false);
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });
});
