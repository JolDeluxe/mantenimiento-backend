import { describe, expect, it } from "bun:test";
import { BIQueryService } from "../services/bi_query_service";
import { calcularMetricasTecnicasFallas } from "../calculations/mttr";
import { CalidadDato, EstadoFalla } from "@prisma/client";

describe("KPIs e Indicadores de BI con Históricos Estimados", () => {
  it("debe procesar correctamente fallas con CalidadDato.HISTORICO_ESTIMADO e incluir sus intervalos de tiempo", () => {
    const fallas = [
      {
        id: 1,
        tareaId: 101,
        fechaFallaConfirmada: new Date("2025-01-15T08:00:00Z"),
        fechaRestauracion: new Date("2025-01-15T10:00:00Z"),
        estado: EstadoFalla.CERRADA,
        calidadDato: CalidadDato.HISTORICO_ESTIMADO,
        contabilizaComoFalla: true,
      },
    ];

    const intervalos = new Map([
      [
        101,
        [
          {
            id: 201,
            tareaId: 101,
            inicio: new Date("2025-01-15T08:00:00Z"),
            fin: new Date("2025-01-15T10:00:00Z"),
          },
        ],
      ],
    ]);

    const desde = new Date("2025-01-01T00:00:00Z");
    const hasta = new Date("2025-02-01T00:00:00Z");

    const result = calcularMetricasTecnicasFallas(fallas, intervalos, desde, hasta);

    expect(result.mttr.fallasRestauradasUsadas).toBe(1);
    expect(result.mttr.sumaMinutosTrabajoTecnico).toBe(120);
    expect(result.mttr.valorMinutos).toBe(120);
    expect(result.mttr.estado).toBe("CALCULABLE");
  });

  it("debe ignorar fallas sin tarea y no contabilizarlas con 0 minutos", () => {
    const fallas = [
      {
        id: 1,
        tareaId: null,
        fechaFallaConfirmada: new Date("2025-01-15T08:00:00Z"),
        fechaRestauracion: new Date("2025-01-15T10:00:00Z"),
        estado: EstadoFalla.CERRADA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
      },
    ];

    const desde = new Date("2025-01-01T00:00:00Z");
    const hasta = new Date("2025-02-01T00:00:00Z");

    const result = calcularMetricasTecnicasFallas(fallas, new Map(), desde, hasta);

    expect(result.mttr.fallasRestauradasUsadas).toBe(0);
    expect(result.mttr.sumaMinutosTrabajoTecnico).toBe(0);
    expect(result.mttr.estado).toBe("MUESTRA_INSUFICIENTE");
    expect(result.mttr.advertencias).toContain("FALLA_SIN_TAREA_VINCULADA");
  });
});
