import { describe, expect, it } from "bun:test";
import { calcularPlanTareas } from "../calculations/planificacion";
import { EstadoTarea } from "@prisma/client";

describe("Planificación de tareas (calcularPlanTareas)", () => {
  const desde = new Date("2026-08-04T00:00:00-06:00"); // lunes
  const hastaExclusivo = new Date("2026-08-11T00:00:00-06:00");

  // ─────────────────────────────────────────────────────
  // Prioridad 1: rango horaInicioProgramada / horaFinProgramada
  // ─────────────────────────────────────────────────────

  it("usa horaInicioProgramada / horaFinProgramada como prioridad 1", () => {
    const tareas = [
      {
        id: 1,
        estado: EstadoTarea.PENDIENTE,
        horaInicioProgramada: new Date("2026-08-04T08:00:00-06:00"),
        horaFinProgramada: new Date("2026-08-04T10:30:00-06:00"), // 150 min
        tiempoEstimado: 60, // no debe usarse
      },
    ];

    const { planPorDia } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    expect(planPorDia["2026-08-04"]).toBe(150);
  });

  it("cae al fallback tiempoEstimado cuando hay fecha programada real", () => {
    const tareas = [
      {
        id: 2,
        estado: EstadoTarea.PENDIENTE,
        horaInicioProgramada: null,
        horaFinProgramada: null,
        fechaVencimiento: new Date("2026-08-05T00:00:00-06:00"),
        tiempoEstimado: 90,
      },
    ];

    const { planPorDia } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    const totalPlanificado = Object.values(planPorDia).reduce((a, b) => a + b, 0);
    expect(totalPlanificado).toBe(90);
    expect(planPorDia["2026-08-05"]).toBe(90);
  });

  it("cuenta tareas sin ningún tiempo como tareasSinTiempoProgramado", () => {
    const tareas = [
      {
        id: 3,
        estado: EstadoTarea.EN_PROGRESO,
        horaInicioProgramada: null,
        horaFinProgramada: null,
        tiempoEstimado: null,
      },
    ];

    const { tareasSinTiempoProgramado } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    expect(tareasSinTiempoProgramado).toBe(1);
  });

  // ─────────────────────────────────────────────────────
  // Exclusión de CANCELADAS
  // ─────────────────────────────────────────────────────

  it("excluye tareas CANCELADAS del plan", () => {
    const tareas = [
      {
        id: 4,
        estado: EstadoTarea.CANCELADA,
        horaInicioProgramada: new Date("2026-08-04T08:00:00-06:00"),
        horaFinProgramada: new Date("2026-08-04T10:00:00-06:00"), // 120 min
        tiempoEstimado: 120,
      },
    ];

    const { planPorDia, tareasSinTiempoProgramado } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    const totalPlanificado = Object.values(planPorDia).reduce((a, b) => a + b, 0);
    expect(totalPlanificado).toBe(0);
    expect(tareasSinTiempoProgramado).toBe(0); // cancelada, no cuenta como "sin tiempo"
  });

  // ─────────────────────────────────────────────────────
  // Cruce de medianoche en rango programado
  // ─────────────────────────────────────────────────────

  it("rango horaInicioProgramada-horaFinProgramada que cruza medianoche se reparte por fecha local", () => {
    const tareas = [
      {
        id: 5,
        estado: EstadoTarea.PENDIENTE,
        horaInicioProgramada: new Date("2026-08-04T22:00:00-06:00"),
        horaFinProgramada: new Date("2026-08-05T02:00:00-06:00"), // 240 min
        tiempoEstimado: 30,
      },
    ];

    const { planPorDia } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    expect(planPorDia["2026-08-04"]).toBe(120);
    expect(planPorDia["2026-08-05"]).toBe(120);
  });

  // ─────────────────────────────────────────────────────
  // Plan vacío (sin tareas)
  // ─────────────────────────────────────────────────────

  it("retorna plan vacío y cero tareasSinTiempoProgramado si no hay tareas", () => {
    const { planPorDia, tareasSinTiempoProgramado } = calcularPlanTareas([], desde, hastaExclusivo);
    expect(Object.keys(planPorDia).length).toBe(0);
    expect(tareasSinTiempoProgramado).toBe(0);
  });

  // ─────────────────────────────────────────────────────
  // Acumulación de múltiples tareas en mismo día
  // ─────────────────────────────────────────────────────

  it("acumula múltiples tareas del mismo día", () => {
    const tareas = [
      {
        id: 10,
        estado: EstadoTarea.PENDIENTE,
        horaInicioProgramada: new Date("2026-08-06T08:00:00-06:00"),
        horaFinProgramada: new Date("2026-08-06T09:00:00-06:00"), // 60
        tiempoEstimado: 60,
      },
      {
        id: 11,
        estado: EstadoTarea.EN_PROGRESO,
        horaInicioProgramada: new Date("2026-08-06T10:00:00-06:00"),
        horaFinProgramada: new Date("2026-08-06T11:30:00-06:00"), // 90
        tiempoEstimado: 90,
      },
    ];

    const { planPorDia } = calcularPlanTareas(tareas, desde, hastaExclusivo);
    expect(planPorDia["2026-08-06"]).toBe(150); // 60 + 90
  });

  // ─────────────────────────────────────────────────────
  // Preventivos recurrentes (solo días futuros)
  // ─────────────────────────────────────────────────────

  it("no genera preventivos recurrentes para fechas pasadas o actuales", () => {
    const pasado = new Date("2026-08-01T00:00:00-06:00");
    const hastaFuturo = new Date("2026-08-08T00:00:00-06:00");
    const preventivos = [
      {
        id: 100,
        frecuenciaDias: 7,
        ultimoMantenimiento: new Date("2026-07-25T00:00:00-06:00"),
        tiempoEstimadoMinutos: 60,
      },
    ];

    const { planPorDia } = calcularPlanTareas([], pasado, hastaFuturo, preventivos);
    // Los días hasta hoy (2026-08-10) ya pasaron todos en este rango, no deben tener plan por preventivos
    // (la función solo agrega para días > hoy)
    const diasConPlan = Object.entries(planPorDia).filter(([, v]) => v > 0);
    // No esperamos ningún día con plan de preventivo recurrente en el pasado
    for (const [dia] of diasConPlan) {
      // Verificar que ninguno es menor o igual a hoy
      expect(dia > "2026-08-10").toBe(true);
    }
  });
});
