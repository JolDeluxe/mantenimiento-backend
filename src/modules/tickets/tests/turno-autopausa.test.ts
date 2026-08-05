import { describe, expect, it } from "bun:test";
import { calcularFinAutoPausaIntervalo } from "../automations";
import { getFinOficialTurno, getTipoJornadaTurno, TURNO_CONFIG } from "../turno-config";

describe("Turno operativo y auto-pausa - reglas puras", () => {
  it("resuelve jornada de lunes a viernes y fin oficial 17:30", () => {
    const lunesAutoPausa = new Date("2026-08-03T17:45:00-06:00");
    expect(getTipoJornadaTurno(lunesAutoPausa)).toBe("SEMANA");
    expect(TURNO_CONFIG.SEMANA.horaAdvertencia).toBe("17:15");
    expect(TURNO_CONFIG.SEMANA.horaFin).toBe("17:30");
    expect(TURNO_CONFIG.SEMANA.horaAutoPausa).toBe("17:45");
    expect(getFinOficialTurno(lunesAutoPausa, "SEMANA")?.toISOString()).toBe("2026-08-03T23:30:00.000Z");
  });

  it("resuelve sábado y fin oficial 14:00", () => {
    const sabadoAutoPausa = new Date("2026-08-08T14:15:00-06:00");
    expect(getTipoJornadaTurno(sabadoAutoPausa)).toBe("SABADO");
    expect(TURNO_CONFIG.SABADO.horaAdvertencia).toBe("13:45");
    expect(TURNO_CONFIG.SABADO.horaFin).toBe("14:00");
    expect(TURNO_CONFIG.SABADO.horaAutoPausa).toBe("14:15");
    expect(getFinOficialTurno(sabadoAutoPausa, "SABADO")?.toISOString()).toBe("2026-08-08T20:00:00.000Z");
  });

  it("no resuelve jornada ordinaria en domingo", () => {
    const domingo = new Date("2026-08-09T14:15:00-06:00");
    expect(getTipoJornadaTurno(domingo)).toBeNull();
    expect(getFinOficialTurno(domingo)).toBeNull();
  });

  it("cierra intervalo iniciado antes del fin oficial en el corte 17:30", () => {
    const ahora = new Date("2026-08-03T17:45:00-06:00");
    const finOficial = getFinOficialTurno(ahora, "SEMANA")!;
    const result = calcularFinAutoPausaIntervalo(
      new Date("2026-08-03T16:30:00-06:00"),
      ahora,
      finOficial,
    );
    expect(result.fin.toISOString()).toBe("2026-08-03T23:30:00.000Z");
    expect(result.advertencia).toBeNull();
  });

  it("cierra intervalo iniciado antes del fin oficial sábado en el corte 14:00", () => {
    const ahora = new Date("2026-08-08T14:15:00-06:00");
    const finOficial = getFinOficialTurno(ahora, "SABADO")!;
    const result = calcularFinAutoPausaIntervalo(
      new Date("2026-08-08T08:00:00-06:00"),
      ahora,
      finOficial,
    );
    expect(result.fin.toISOString()).toBe("2026-08-08T20:00:00.000Z");
    expect(result.advertencia).toBeNull();
  });

  it("intervalo iniciado después del fin oficial cierra en la auto-pausa real y no genera duración negativa", () => {
    const ahora = new Date("2026-08-03T17:45:00-06:00");
    const finOficial = getFinOficialTurno(ahora, "SEMANA")!;
    const inicio = new Date("2026-08-03T17:35:00-06:00");
    const result = calcularFinAutoPausaIntervalo(inicio, ahora, finOficial);
    const minutos = Math.floor((result.fin.getTime() - inicio.getTime()) / 60000);
    expect(result.fin.toISOString()).toBe("2026-08-03T23:45:00.000Z");
    expect(result.advertencia).toBe("INTERVALO_INICIADO_FUERA_DE_TURNO");
    expect(minutos).toBe(10);
  });
});
