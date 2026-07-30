import { describe, expect, test } from "bun:test";
import { FrecuenciaRecurrencia } from "@prisma/client";
import { calcularSiguienteFechaLogica, normalizarFechaLogica } from "./helper";

describe("caracterización de recurrencias preventivas existentes", () => {
  test("conserva normalización y frecuencia semanal actuales", () => {
    const start = normalizarFechaLogica("2026-01-01");
    expect(calcularSiguienteFechaLogica(start, FrecuenciaRecurrencia.SEMANAL).toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });

  test("conserva la semántica mensual actual sin modificarla", () => {
    const january31 = normalizarFechaLogica("2025-01-31");
    const february = calcularSiguienteFechaLogica(january31, FrecuenciaRecurrencia.MENSUAL);
    const march = calcularSiguienteFechaLogica(february, FrecuenciaRecurrencia.MENSUAL);
    expect(february.toISOString()).toBe("2025-02-28T00:00:00.000Z");
    expect(march.toISOString()).toBe("2025-03-28T00:00:00.000Z");
  });
});
