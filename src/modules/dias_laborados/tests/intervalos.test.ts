import { describe, expect, it } from "bun:test";
import { calcularTiempoReal } from "../calculations/intervalos";
import { EstadoTarea, TipoTarea, ClasificacionTarea } from "@prisma/client";

describe("Cálculo de Tiempo Real (Línea de tiempo lineal independiente)", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaExclusivo = new Date("2026-08-10T00:00:00-06:00");
  const ahora = new Date("2026-08-05T12:00:00-06:00");

  // Helpers
  const mkTicketMaquina = (id: number, usuarioId: number, inicio: string, fin: string) => ({
    id,
    usuarioId,
    estado: EstadoTarea.EN_PROGRESO,
    inicio: new Date(inicio),
    fin: new Date(fin),
    tarea: { tipo: TipoTarea.TICKET, clasificacion: ClasificacionTarea.CORRECTIVO, maquinaId: 1 },
  });

  const mkTicketActividad = (id: number, usuarioId: number, inicio: string, fin: string) => ({
    id,
    usuarioId,
    estado: EstadoTarea.EN_PROGRESO,
    inicio: new Date(inicio),
    fin: new Date(fin),
    tarea: { tipo: TipoTarea.TICKET, clasificacion: null, maquinaId: null },
  });

  const mkPlaneada = (id: number, usuarioId: number, inicio: string, fin: string) => ({
    id,
    usuarioId,
    estado: EstadoTarea.EN_PROGRESO,
    inicio: new Date(inicio),
    fin: new Date(fin),
    tarea: { tipo: TipoTarea.PLANEADA, clasificacion: null, maquinaId: null },
  });

  // ───────────────────────────────────────────────────────────
  // Regla central: suma lineal independiente (no deduplicación)
  // ───────────────────────────────────────────────────────────

  it("60+60 solapados mismo técnico = 120 (no 90)", () => {
    const intervalos = [
      mkTicketMaquina(1, 10, "2026-08-05T08:00:00-06:00", "2026-08-05T09:00:00-06:00"), // 60
      mkTicketMaquina(2, 10, "2026-08-05T08:30:00-06:00", "2026-08-05T09:30:00-06:00"), // 60
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    const day = tiempoRealPorDia["2026-08-05"];
    expect(day).toBeDefined();
    expect(day?.MANTENIMIENTO_CORRECTIVO).toBe(120);
  });

  it("60 + 40 + 30 = 130 minutos-persona", () => {
    const intervalos = [
      mkTicketMaquina(10, 20, "2026-08-04T08:00:00-06:00", "2026-08-04T09:00:00-06:00"), // 60
      mkTicketMaquina(11, 21, "2026-08-04T09:00:00-06:00", "2026-08-04T09:40:00-06:00"), // 40
      mkTicketMaquina(12, 22, "2026-08-04T09:40:00-06:00", "2026-08-04T10:10:00-06:00"), // 30
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(tiempoRealPorDia["2026-08-04"]?.MANTENIMIENTO_CORRECTIVO).toBe(130);
  });

  it("dos técnicos simultáneos suman minutos-persona (60+60 = 120, no 60)", () => {
    const intervalos = [
      mkPlaneada(20, 30, "2026-08-03T10:00:00-06:00", "2026-08-03T11:00:00-06:00"), // 60
      mkPlaneada(21, 31, "2026-08-03T10:00:00-06:00", "2026-08-03T11:00:00-06:00"), // 60
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(tiempoRealPorDia["2026-08-03"]?.ACTIVIDAD_PLANEADA).toBe(120);
  });

  // ─────────────────────────────────
  // Cruce de medianoche México
  // ─────────────────────────────────

  it("cruce de medianoche: fracciona en 04/08 y 05/08 correctamente", () => {
    const intervalos = [
      mkTicketMaquina(3, 11, "2026-08-04T22:00:00-06:00", "2026-08-05T02:00:00-06:00"),
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(tiempoRealPorDia["2026-08-04"]?.MANTENIMIENTO_CORRECTIVO).toBe(120); // 22:00–00:00
    expect(tiempoRealPorDia["2026-08-05"]?.MANTENIMIENTO_CORRECTIVO).toBe(120); // 00:00–02:00
  });

  // ─────────────────────────────────
  // Clip al periodo
  // ─────────────────────────────────

  it("clip al periodo: inicio antes de 'desde' se recorta al límite del periodo", () => {
    const intervalos = [
      mkTicketActividad(30, 40, "2026-07-31T23:00:00-06:00", "2026-08-01T01:00:00-06:00"),
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    // Solo cuenta desde 00:00 del 01/08 hasta 01:00 = 60 min
    expect(tiempoRealPorDia["2026-08-01"]?.ACTIVIDAD_REPORTE).toBe(60);
  });

  it("clip al periodo: fin después de hastaExclusivo se recorta al límite del periodo", () => {
    const intervalos = [
      mkTicketActividad(31, 41, "2026-08-09T23:00:00-06:00", "2026-08-10T02:00:00-06:00"),
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    // hasta es 2026-08-10T00:00:00-06:00 exclusivo, entonces sólo 23:00–00:00 = 60 min
    expect(tiempoRealPorDia["2026-08-09"]?.ACTIVIDAD_REPORTE).toBe(60);
  });

  // ─────────────────────────────────
  // Fuera del periodo
  // ─────────────────────────────────

  it("intervalo completamente fuera del periodo no se suma", () => {
    const intervalos = [
      mkTicketActividad(32, 42, "2026-08-11T08:00:00-06:00", "2026-08-11T09:00:00-06:00"),
    ];

    const { tiempoRealPorDia } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(Object.keys(tiempoRealPorDia).length).toBe(0);
  });

  // ─────────────────────────────────
  // Intervalos abiertos
  // ─────────────────────────────────

  it("intervalo abierto del día actual (hoy): usa 'ahora' como fin", () => {
    // ahora = 2026-08-05T12:00:00-06:00
    const ahoraLocal = new Date("2026-08-05T12:00:00-06:00");
    const intervalos = [
      {
        id: 40,
        usuarioId: 50,
        estado: EstadoTarea.EN_PROGRESO,
        inicio: new Date("2026-08-05T11:00:00-06:00"), // 60 min antes de ahora
        fin: null,
        tarea: { tipo: TipoTarea.PLANEADA, clasificacion: null, maquinaId: null },
      },
    ];

    const { tiempoRealPorDia, fechasConIntervaloAbierto, calidadDatos } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahoraLocal);
    expect(tiempoRealPorDia["2026-08-05"]?.ACTIVIDAD_PLANEADA).toBe(60);
    expect(fechasConIntervaloAbierto).toEqual(["2026-08-05"]);
    expect(calidadDatos.intervalosAbiertosHistoricos).toBe(0);
  });

  it("intervalo abierto histórico (día pasado): NO se suma y se contabiliza en calidadDatos", () => {
    const intervalos = [
      {
        id: 4,
        usuarioId: 12,
        estado: EstadoTarea.EN_PROGRESO,
        inicio: new Date("2026-08-02T10:00:00-06:00"),
        fin: null,
        tarea: { tipo: TipoTarea.TICKET, clasificacion: ClasificacionTarea.CORRECTIVO, maquinaId: 1 },
      },
    ];

    const { tiempoRealPorDia, fechasConIntervaloAbierto, calidadDatos } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(calidadDatos.intervalosAbiertosHistoricos).toBe(1);
    expect(fechasConIntervaloAbierto).toEqual([]);
    expect(tiempoRealPorDia["2026-08-02"]).toBeUndefined();
  });

  // ─────────────────────────────────
  // Estado del intervalo
  // ─────────────────────────────────

  it("excluye intervalos con estado diferente a EN_PROGRESO", () => {
    const intervalos = [
      {
        id: 50,
        usuarioId: 60,
        estado: EstadoTarea.EN_PAUSA,
        inicio: new Date("2026-08-05T08:00:00-06:00"),
        fin: new Date("2026-08-05T09:00:00-06:00"),
        tarea: { tipo: TipoTarea.TICKET, clasificacion: null, maquinaId: null },
      },
    ];

    const { tiempoRealPorDia, calidadDatos } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(calidadDatos.intervalosFueraDeProgreso).toBe(1);
    expect(Object.keys(tiempoRealPorDia).length).toBe(0);
  });

  // ─────────────────────────────────
  // Bucket vacío
  // ─────────────────────────────────

  it("lista vacía de intervalos devuelve bucket vacío sin errores", () => {
    const { tiempoRealPorDia } = calcularTiempoReal([], desde, hastaExclusivo, ahora);
    expect(Object.keys(tiempoRealPorDia).length).toBe(0);
  });

  it("intervalo AUTÓNOMO no se clasifica y se cuenta como sin clasificación", () => {
    const intervalos = [
      {
        id: 60,
        usuarioId: 70,
        estado: EstadoTarea.EN_PROGRESO,
        inicio: new Date("2026-08-05T08:00:00-06:00"),
        fin: new Date("2026-08-05T09:00:00-06:00"),
        tarea: { tipo: TipoTarea.TICKET, clasificacion: ClasificacionTarea.AUTONOMO, maquinaId: null },
      },
    ];

    const { tiempoRealPorDia, calidadDatos } = calcularTiempoReal(intervalos, desde, hastaExclusivo, ahora);
    expect(calidadDatos.intervalosSinClasificacion).toBe(1);
    expect(Object.keys(tiempoRealPorDia).length).toBe(0);
  });
});
