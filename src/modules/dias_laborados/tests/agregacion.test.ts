import { describe, expect, it } from "bun:test";
import { construirFilasDiarias, construirFilasMensuales, construirSummary, calcularDesgloseTiempoReal } from "../calculations/agregacion";
import type { AcumuladoBuckets } from "../types";

// ─────────────────────────────────────────────────────────────
// Calendario real de Semana 32 de 2026:
//   Lun 03, Mar 04, Mié 05, Jue 06, Vie 07, Sáb 08, Dom 09
// ─────────────────────────────────────────────────────────────

const BUCKETS_VACIOS: AcumuladoBuckets = {
  ACTIVIDAD_REPORTE: 0,
  ACTIVIDAD_PLANEADA: 0,
  ACTIVIDAD_EXTRAORDINARIA: 0,
  MANTENIMIENTO_PREVENTIVO: 0,
  MANTENIMIENTO_CORRECTIVO: 0,
};

// 2026-08-07 es viernes; las 23:00 es después del cierre de semana (17:30) → EN_CURSO ya cerró
const AHORA_TARDE = new Date("2026-08-07T23:00:00-06:00");
// Las 12:00 del viernes 07 → EN_CURSO (dentro del horario)
const AHORA_MEDIODÍA = new Date("2026-08-07T12:00:00-06:00");

describe("calcularDesgloseTiempoReal", () => {
  it("desglosa correctamente los buckets en actividades y mantenimientos", () => {
    const buckets: AcumuladoBuckets = {
      ACTIVIDAD_REPORTE: 30,
      ACTIVIDAD_PLANEADA: 45,
      ACTIVIDAD_EXTRAORDINARIA: 15,
      MANTENIMIENTO_PREVENTIVO: 60,
      MANTENIMIENTO_CORRECTIVO: 90,
    };

    const desglose = calcularDesgloseTiempoReal(buckets);

    expect(desglose.totalMinutos).toBe(240);
    expect(desglose.actividades.totalMinutos).toBe(90);
    expect(desglose.actividades.reportesMinutos).toBe(30);
    expect(desglose.actividades.planeadasMinutos).toBe(45);
    expect(desglose.actividades.extraordinariasMinutos).toBe(15);
    expect(desglose.mantenimientos.totalMinutos).toBe(150);
    expect(desglose.mantenimientos.preventivosMinutos).toBe(60);
    expect(desglose.mantenimientos.correctivosMinutos).toBe(90);
  });

  it("devuelve cero en todos los campos cuando buckets están vacíos", () => {
    const desglose = calcularDesgloseTiempoReal(BUCKETS_VACIOS);
    expect(desglose.totalMinutos).toBe(0);
    expect(desglose.actividades.totalMinutos).toBe(0);
    expect(desglose.mantenimientos.totalMinutos).toBe(0);
  });
});

describe("construirFilasDiarias", () => {
  // Semana 32 de 2026:
  //   Lun=03, Mar=04, Mié=05, Jue=06, Vie=07, Sáb=08, Dom=09

  it("lunes a viernes tienen tiempoDisponibleMinutos = 5400 (ORDINARIA)", () => {
    const filas = construirFilasDiarias(
      ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"],
      {},
      {},
      AHORA_TARDE
    );

    expect(filas.length).toBe(5);
    for (const fila of filas) {
      expect(fila.tiempoDisponibleMinutos).toBe(5400);
      expect(fila.jornada).toBe("ORDINARIA");
      expect(fila.laborado).toBe("SI");
    }
    const totalDisponible = filas.reduce((s, f) => s + f.tiempoDisponibleMinutos, 0);
    expect(totalDisponible).toBe(5 * 5400);
  });

  it("sábado (2026-08-08) tiene tiempoDisponibleMinutos = 3600", () => {
    const filas = construirFilasDiarias(["2026-08-08"], {}, {}, AHORA_TARDE);
    expect(filas.length).toBe(1);
    const fila = filas[0];
    expect(fila?.tiempoDisponibleMinutos).toBe(3600);
    expect(fila?.jornada).toBe("SABADO");
    expect(fila?.laborado).toBe("SABADO");
  });

  it("domingo (2026-08-09) sin actividad no genera fila", () => {
    const filas = construirFilasDiarias(["2026-08-09"], {}, {}, AHORA_TARDE);
    expect(filas.length).toBe(0);
  });

  it("domingo (2026-08-09) con actividad genera fila EXTRAORDINARIO", () => {
    const tiempoRealDomingo: Record<string, AcumuladoBuckets> = {
      "2026-08-09": {
        ...BUCKETS_VACIOS,
        ACTIVIDAD_REPORTE: 360,
      },
    };

    const filas = construirFilasDiarias(["2026-08-09"], tiempoRealDomingo, {}, AHORA_TARDE);
    expect(filas.length).toBe(1);
    const fila = filas[0];
    expect(fila?.jornada).toBe("EXTRAORDINARIO");
    expect(fila?.laborado).toBe("EXTRAORDINARIO");
    expect(fila?.tiempoReal.totalMinutos).toBe(360);
  });

  it("día actual (viernes 07) dentro de horario → estado EN_CURSO y provisional = true", () => {
    // AHORA_MEDIODÍA = 2026-08-07T12:00:00-06:00 → hoyKey = "2026-08-07"
    const filas = construirFilasDiarias(["2026-08-07"], {}, {}, AHORA_MEDIODÍA);
    expect(filas.length).toBe(1);
    const fila = filas[0];
    expect(fila?.estado).toBe("EN_CURSO");
    expect(fila?.provisional).toBe(true);
  });

  it("día actual (viernes 07) después del cierre → estado CERRADO y provisional = false", () => {
    // AHORA_TARDE = 2026-08-07T23:00:00-06:00 → hoy pero después del cierre
    const filas = construirFilasDiarias(["2026-08-07"], {}, {}, AHORA_TARDE);
    expect(filas.length).toBe(1);
    const fila = filas[0];
    expect(fila?.estado).toBe("CERRADO");
    expect(fila?.provisional).toBe(false);
  });

  it("día futuro → estado PROGRAMADO", () => {
    // 2026-08-10 es futuro respecto de 07/08
    const filas = construirFilasDiarias(["2026-08-10"], {}, {}, AHORA_TARDE);
    expect(filas.length).toBe(1);
    expect(filas[0]?.estado).toBe("PROGRAMADO");
  });

  it("calcula ratios realVsDisponible y realVsPlan correctamente", () => {
    const tiempoReal: Record<string, AcumuladoBuckets> = {
      "2026-08-03": {
        ...BUCKETS_VACIOS,
        ACTIVIDAD_REPORTE: 2700,
      },
    };

    const plan: Record<string, number> = {
      "2026-08-03": 3600,
    };

    const filas = construirFilasDiarias(["2026-08-03"], tiempoReal, plan, AHORA_TARDE);
    const fila = filas[0];
    expect(fila).toBeDefined();

    // 2700 / 5400 * 100 = 50
    expect(fila?.realVsDisponible).toBe(50);
    // 2700 / 3600 * 100 = 75
    expect(fila?.realVsPlan).toBe(75);
  });

  it("realVsPlan es null cuando tiempoProgramado es 0", () => {
    const tiempoReal: Record<string, AcumuladoBuckets> = {
      "2026-08-03": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 100 },
    };

    const filas = construirFilasDiarias(["2026-08-03"], tiempoReal, {}, AHORA_TARDE);
    expect(filas[0]?.realVsPlan).toBeNull();
  });

  it("dia conserva únicamente el nombre civil en México", () => {
    const filas = construirFilasDiarias(["2026-08-03"], {}, {}, AHORA_TARDE);
    expect(filas[0]?.dia).toBe("Lunes");
  });

  it("domingo actual con trabajo cerrado no queda EN_CURSO", () => {
    const ahoraDomingo = new Date("2026-08-09T12:00:00-06:00");
    const tiempoRealDomingo: Record<string, AcumuladoBuckets> = {
      "2026-08-09": {
        ...BUCKETS_VACIOS,
        MANTENIMIENTO_CORRECTIVO: 45,
      },
    };

    const filas = construirFilasDiarias(["2026-08-09"], tiempoRealDomingo, {}, ahoraDomingo);
    expect(filas[0]?.estado).toBe("CERRADO");
    expect(filas[0]?.provisional).toBe(false);
  });

  it("domingo actual con intervalo abierto queda EN_CURSO", () => {
    const ahoraDomingo = new Date("2026-08-09T12:00:00-06:00");
    const tiempoRealDomingo: Record<string, AcumuladoBuckets> = {
      "2026-08-09": {
        ...BUCKETS_VACIOS,
        MANTENIMIENTO_CORRECTIVO: 45,
      },
    };

    const filas = construirFilasDiarias(
      ["2026-08-09"],
      tiempoRealDomingo,
      {},
      ahoraDomingo,
      new Set(["2026-08-09"])
    );
    expect(filas[0]?.estado).toBe("EN_CURSO");
    expect(filas[0]?.provisional).toBe(true);
  });
});

describe("construirFilasMensuales", () => {
  it("agrupa filas diarias por mes y suma tiempoReal correctamente", () => {
    const tiempoRealLunes: Record<string, AcumuladoBuckets> = {
      "2026-08-03": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 120 },
      "2026-08-04": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 60 },
    };

    const filasDiarias = construirFilasDiarias(
      ["2026-08-03", "2026-08-04"],
      tiempoRealLunes,
      {},
      AHORA_TARDE
    );

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    expect(mensuales.length).toBe(12);
    const agosto = mensuales.find((m) => m.mes === 8);
    expect(agosto?.mes).toBe(8);
    expect(agosto?.mesNombre).toBe("Agosto");
    expect(agosto?.periodo).toBe("2026-08");
    expect(agosto?.tiempoReal.totalMinutos).toBe(180);
  });

  it("provisional = true si algún día del mes es provisional", () => {
    // AHORA_MEDIODÍA = viernes 07 a las 12:00 → "2026-08-07" es EN_CURSO y provisional
    const filasDiarias = construirFilasDiarias(
      ["2026-08-03", "2026-08-07"],
      {},
      {},
      AHORA_MEDIODÍA
    );

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    expect(mensuales.find((m) => m.mes === 8)?.provisional).toBe(true);
  });

  it("provisional = false si todos los días están cerrados o programados", () => {
    // AHORA_TARDE = viernes 07 a las 23:00 → 03 y 06 son pasado (CERRADO), 10 es futuro (PROGRAMADO)
    const filasDiarias = construirFilasDiarias(
      ["2026-08-03", "2026-08-06", "2026-08-10"],
      {},
      {},
      AHORA_TARDE
    );

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    expect(mensuales.find((m) => m.mes === 8)?.provisional).toBe(false);
  });

  it("agrupa correctamente múltiples meses (ANIO)", () => {
    const tiempoReal: Record<string, AcumuladoBuckets> = {
      "2026-01-05": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 100 },
      "2026-03-10": { ...BUCKETS_VACIOS, MANTENIMIENTO_CORRECTIVO: 200 },
    };

    const filasDiarias = construirFilasDiarias(
      ["2026-01-05", "2026-03-10"],
      tiempoReal,
      {},
      AHORA_TARDE
    );

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    expect(mensuales.length).toBe(12);

    const enero = mensuales.find((m) => m.mes === 1);
    const marzo = mensuales.find((m) => m.mes === 3);
    const diciembre = mensuales.find((m) => m.mes === 12);

    expect(enero?.tiempoReal.actividades.reportesMinutos).toBe(100);
    expect(enero?.periodo).toBe("2026-01");
    expect(marzo?.tiempoReal.mantenimientos.correctivosMinutos).toBe(200);
    expect(marzo?.periodo).toBe("2026-03");
    expect(diciembre?.periodo).toBe("2026-12");
    expect(diciembre?.tiempoReal.totalMinutos).toBe(0);
  });

  it("domingo sin trabajo no genera fila, pero ANIO conserva los 12 meses", () => {
    // 2026-08-09 es domingo, sin actividad → construirFilasDiarias retorna []
    const filasDiarias = construirFilasDiarias(["2026-08-09"], {}, {}, AHORA_TARDE);
    expect(filasDiarias.length).toBe(0);

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    expect(mensuales.length).toBe(12);
    expect(mensuales.every((m) => m.tiempoReal.totalMinutos === 0)).toBe(true);
  });

  it("suma acumulada de buckets en varios días del mismo mes", () => {
    const tiempoReal: Record<string, AcumuladoBuckets> = {
      "2026-08-03": { ...BUCKETS_VACIOS, MANTENIMIENTO_PREVENTIVO: 60 },
      "2026-08-04": { ...BUCKETS_VACIOS, MANTENIMIENTO_CORRECTIVO: 90 },
      "2026-08-05": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 30 },
    };

    const filasDiarias = construirFilasDiarias(
      ["2026-08-03", "2026-08-04", "2026-08-05"],
      tiempoReal,
      {},
      AHORA_TARDE
    );

    const mensuales = construirFilasMensuales(filasDiarias, 2026);
    const agosto = mensuales.find((m) => m.mes === 8);

    expect(agosto?.tiempoReal.mantenimientos.preventivosMinutos).toBe(60);
    expect(agosto?.tiempoReal.mantenimientos.correctivosMinutos).toBe(90);
    expect(agosto?.tiempoReal.actividades.reportesMinutos).toBe(30);
    expect(agosto?.tiempoReal.totalMinutos).toBe(180);
    expect(agosto?.tiempoDisponibleMinutos).toBe(3 * 5400); // 3 ordinarios
  });
});

describe("construirSummary", () => {
  it("suma minutos y marca provisional si alguna fila diaria es provisional", () => {
    const tiempoReal: Record<string, AcumuladoBuckets> = {
      "2026-08-03": { ...BUCKETS_VACIOS, ACTIVIDAD_REPORTE: 120 },
      "2026-08-07": { ...BUCKETS_VACIOS, MANTENIMIENTO_CORRECTIVO: 60 },
    };

    const plan: Record<string, number> = {
      "2026-08-03": 60,
      "2026-08-07": 30,
    };

    const filas = construirFilasDiarias(
      ["2026-08-03", "2026-08-07"],
      tiempoReal,
      plan,
      AHORA_MEDIODÍA
    );

    const summary = construirSummary(filas);

    expect(summary.tiempoDisponibleMinutos).toBe(10800);
    expect(summary.tiempoProgramadoMinutos).toBe(90);
    expect(summary.tiempoReal.totalMinutos).toBe(180);
    expect(summary.realVsDisponible).toBe(1.67);
    expect(summary.realVsPlan).toBe(200);
    expect(summary.provisional).toBe(true);
  });
});
