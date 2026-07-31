import { describe, expect, test } from "bun:test";
import { FrecuenciaRecurrencia } from "@prisma/client";
import { calcularSiguienteFechaLogica, normalizarFechaLogica, generarProyeccionesPorAno } from "./helper";

describe("regla temporal trimestral", () => {
  test("trimestral con fecha normal (15/01/2026)", () => {
    const inicio = normalizarFechaLogica("2026-01-15");
    const next1 = calcularSiguienteFechaLogica(inicio, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);
    const next2 = calcularSiguienteFechaLogica(next1, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);
    const next3 = calcularSiguienteFechaLogica(next2, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);

    expect(next1.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(next2.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(next3.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });

  test("trimestral con día 31 (Jan 31 -> Apr 30 -> Jul 31 -> Oct 31)", () => {
    const inicio = normalizarFechaLogica("2026-01-31");
    const next1 = calcularSiguienteFechaLogica(inicio, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);
    const next2 = calcularSiguienteFechaLogica(next1, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);
    const next3 = calcularSiguienteFechaLogica(next2, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);

    expect(next1.toISOString()).toBe("2026-04-30T00:00:00.000Z"); // April has 30 days
    expect(next2.toISOString()).toBe("2026-07-31T00:00:00.000Z"); // July has 31 days (recovers anchor)
    expect(next3.toISOString()).toBe("2026-10-31T00:00:00.000Z"); // October has 31 days (recovers anchor)
  });

  test("trimestral cruzando febrero (30/11/2026 -> 28/02/2027 -> 30/05/2027)", () => {
    const inicio = normalizarFechaLogica("2026-11-30");
    const next1 = calcularSiguienteFechaLogica(inicio, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);
    const next2 = calcularSiguienteFechaLogica(next1, FrecuenciaRecurrencia.TRIMESTRAL, null, inicio);

    expect(next1.toISOString()).toBe("2027-02-28T00:00:00.000Z"); // February has 28 days
    expect(next2.toISOString()).toBe("2027-05-30T00:00:00.000Z"); // May has 30 days (recovers anchor)
  });

  test("proyección anual para trimestral", () => {
    const inicio = normalizarFechaLogica("2026-01-15");
    const proyecciones = generarProyeccionesPorAno(inicio, FrecuenciaRecurrencia.TRIMESTRAL, null, 2026, 200, inicio);
    
    expect(proyecciones.map(p => p.toISOString().split("T")[0])).toEqual([
      "2026-01-15",
      "2026-04-15",
      "2026-07-15",
      "2026-10-15"
    ]);
  });
});
