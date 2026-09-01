import { describe, expect, test } from "bun:test";
import { FrecuenciaRecurrencia } from "@prisma/client";
import {
  esCicloProgramadoRecurrencia,
  resolverPoliticaMaterializacionRecurrencia,
} from "./materialization-policy";

const fecha = (value: string) => new Date(`${value}T00:00:00.000Z`);

const regla = (overrides = {}) => ({
  fechaInicio: fecha("2026-08-20"),
  frecuencia: FrecuenciaRecurrencia.PERSONALIZADA_DIAS,
  intervaloDias: 1,
  proximaFechaEjecucion: fecha("2026-08-20"),
  ...overrides,
});

describe("política anti-backlog para mantenimientos preventivos recurrentes", () => {
  test("PERSONALIZADA_DIAS intervalo 1 funciona como diaria: descarta pasado y crea hoy", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(regla(), fecha("2026-09-01"));

    expect(decision.motivo).toBe("MATERIALIZAR_CICLO_VIGENTE");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-02T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBeGreaterThan(0);
  });

  test("semanal atrasada recupera solo la última semana vencida aunque cambie el mes", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({ frecuencia: FrecuenciaRecurrencia.SEMANAL, intervaloDias: null }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("MATERIALIZAR_CICLO_VIGENTE");
    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-08-27T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-03T00:00:00.000Z");
  });

  test("semanal con varios ciclos del mes vigente crea solo el más reciente vencido", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({ frecuencia: FrecuenciaRecurrencia.SEMANAL, intervaloDias: null }),
      fecha("2026-09-10"),
    );

    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-17T00:00:00.000Z");
  });

  test("mensual 31 agosto pendiente y hoy 1 septiembre crea exactamente ese ciclo", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({
        fechaInicio: fecha("2026-08-31"),
        frecuencia: FrecuenciaRecurrencia.MENSUAL,
        intervaloDias: null,
        proximaFechaEjecucion: fecha("2026-08-31"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(0);
  });

  test("mensual con julio, agosto y septiembre vencidos recupera solo septiembre", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({
        fechaInicio: fecha("2026-07-31"),
        frecuencia: FrecuenciaRecurrencia.MENSUAL,
        intervaloDias: null,
        proximaFechaEjecucion: fecha("2026-07-31"),
      }),
      fecha("2026-10-01"),
    );

    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(2);
  });

  test("mensual futura no se adelanta ni se materializa", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({
        fechaInicio: fecha("2026-09-15"),
        frecuencia: FrecuenciaRecurrencia.MENSUAL,
        intervaloDias: null,
        proximaFechaEjecucion: fecha("2026-09-15"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.fechaCicloLogica).toBeNull();
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  test("varios trimestres perdidos materializa solo el trimestre vencido más reciente", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({
        fechaInicio: fecha("2026-01-15"),
        frecuencia: FrecuenciaRecurrencia.TRIMESTRAL,
        intervaloDias: null,
        proximaFechaEjecucion: fecha("2026-01-15"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(2);
  });

  test("PERSONALIZADA_DIAS no diaria analiza su intervalo real y recupera solo última vencida", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({
        frecuencia: FrecuenciaRecurrencia.PERSONALIZADA_DIAS,
        intervaloDias: 10,
        proximaFechaEjecucion: fecha("2026-08-01"),
        fechaInicio: fecha("2026-08-01"),
      }),
      fecha("2026-09-01"),
    );

    expect(decision.fechaCicloLogica?.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(decision.proximaFechaEjecucion.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(decision.ciclosDescartados).toBe(3);
  });

  test("regla futura no materializa ni mueve cursor", () => {
    const decision = resolverPoliticaMaterializacionRecurrencia(
      regla({ fechaInicio: fecha("2026-09-15"), proximaFechaEjecucion: fecha("2026-09-15") }),
      fecha("2026-09-01"),
    );

    expect(decision.motivo).toBe("FUTURA");
    expect(decision.fechaCicloLogica).toBeNull();
    expect(decision.requiereActualizarCursor).toBe(false);
  });

  test("valida ciclos reales para proteger el endpoint manual", () => {
    const mensual = regla({
      fechaInicio: fecha("2026-01-31"),
      frecuencia: FrecuenciaRecurrencia.MENSUAL,
      intervaloDias: null,
    });

    expect(esCicloProgramadoRecurrencia(mensual, fecha("2026-02-28"))).toBe(true);
    expect(esCicloProgramadoRecurrencia(mensual, fecha("2026-02-27"))).toBe(false);
  });
});
