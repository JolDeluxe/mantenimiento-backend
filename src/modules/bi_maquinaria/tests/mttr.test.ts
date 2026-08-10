import { describe, it, expect } from "bun:test";
import { calcularMTTR, normalizarIntervalosTecnicosFalla } from "../calculations/mttr";

describe("MTTR técnico de fallas - Cálculos puros", () => {
  const desde = new Date("2026-08-01T00:00:00-06:00");
  const hastaEfectivo = new Date("2026-08-10T00:00:00-06:00");

  const falla = (overrides: Partial<any> = {}) => ({
    id: 1,
    tareaId: 101,
    fechaFallaConfirmada: new Date("2026-08-03T16:00:00-06:00"),
    fechaRestauracion: new Date("2026-08-04T09:00:00-06:00"),
    estado: "REHABILITADA",
    contabilizaComoFalla: true,
    ...overrides,
  });

  const intervalo = (id: number, inicio: string, fin: string | null, tareaId = 101) => ({
    id,
    tareaId,
    inicio: new Date(inicio),
    fin: fin ? new Date(fin) : null,
  });

  const map = (items: ReturnType<typeof intervalo>[]) => {
    const result = new Map<number, ReturnType<typeof intervalo>[]>();
    for (const item of items) {
      const list = result.get(item.tareaId) || [];
      list.push(item);
      result.set(item.tareaId, list);
    }
    return result;
  };

  it("retorna SIN_DATOS si no hay fallas confirmadas", () => {
    const res = calcularMTTR([], new Map(), desde, hastaEfectivo);
    expect(res.mttr.valorMinutos).toBe(0);
    expect(res.mttr.estado).toBe("SIN_DATOS");
  });

  it("calcula el ejemplo obligatorio del usuario", () => {
    const res = calcularMTTR(
      [falla()],
      map([
        intervalo(1, "2026-08-03T16:30:00-06:00", "2026-08-03T17:30:00-06:00"),
        intervalo(2, "2026-08-04T08:00:00-06:00", "2026-08-04T09:00:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );

    expect(res.tiempoRespuesta.valorPromedioMinutos).toBe(30);
    expect(res.mttr.valorMinutos).toBe(120);
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(120);
    expect(res.restauracionCalendario.valorPromedioMinutos).toBe(1020);
    expect(res.restauracionCalendario.sumaMinutos).toBe(1020);
  });

  it("suma dos intervalos del mismo día y excluye pausas entre ellos", () => {
    const res = calcularMTTR(
      [falla({ fechaFallaConfirmada: new Date("2026-08-03T08:00:00-06:00"), fechaRestauracion: new Date("2026-08-03T12:00:00-06:00") })],
      map([
        intervalo(1, "2026-08-03T08:30:00-06:00", "2026-08-03T09:30:00-06:00"),
        intervalo(2, "2026-08-03T11:00:00-06:00", "2026-08-03T12:00:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.valorMinutos).toBe(120);
    expect(res.tiempoRespuesta.valorPromedioMinutos).toBe(30);
    expect(res.restauracionCalendario.valorPromedioMinutos).toBe(240);
  });

  it("usa inicio y fin guardados del intervalo, sin recortar contra falla o restauración", () => {
    const detalle = normalizarIntervalosTecnicosFalla(
      falla({ fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"), fechaRestauracion: new Date("2026-08-03T12:00:00-06:00") }),
      [
        intervalo(1, "2026-08-03T09:00:00-06:00", "2026-08-03T10:30:00-06:00"),
        intervalo(2, "2026-08-03T11:30:00-06:00", "2026-08-03T13:00:00-06:00"),
      ],
    );
    expect(detalle.tiempoTecnicoActivoMinutos).toBe(180);
    expect(detalle.intervalosEfectivos[0]?.minutos).toBe(90);
    expect(detalle.intervalosEfectivos[1]?.minutos).toBe(90);
  });

  it("incluye intervalos definitivos aunque queden fuera del rango calendario falla-restauración", () => {
    const detalle = normalizarIntervalosTecnicosFalla(
      falla({ fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"), fechaRestauracion: new Date("2026-08-03T12:00:00-06:00") }),
      [
        intervalo(1, "2026-08-03T08:00:00-06:00", "2026-08-03T09:00:00-06:00"),
        intervalo(2, "2026-08-03T13:00:00-06:00", "2026-08-03T14:00:00-06:00"),
      ],
    );
    expect(detalle.calculable).toBe(true);
    expect(detalle.tiempoTecnicoActivoMinutos).toBe(120);
  });

  it("fusiona intervalos solapados y no suma doble dos técnicos simultáneos", () => {
    const res = calcularMTTR(
      [falla({ fechaFallaConfirmada: new Date("2026-08-03T08:00:00-06:00"), fechaRestauracion: new Date("2026-08-03T10:00:00-06:00") })],
      map([
        intervalo(1, "2026-08-03T08:00:00-06:00", "2026-08-03T09:00:00-06:00"),
        intervalo(2, "2026-08-03T08:30:00-06:00", "2026-08-03T09:30:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.valorMinutos).toBe(90);
    expect(res.mttr.advertencias).toContain("INTERVALOS_TECNICOS_SUPERPUESTOS");
  });

  it("intervalo automático de 20 minutos cuenta 20 para tiempo reparación y MTTR", () => {
    const res = calcularMTTR(
      [falla({ fechaFallaConfirmada: new Date("2026-08-05T10:00:00-06:00"), fechaRestauracion: new Date("2026-08-05T10:20:00-06:00") })],
      map([
        intervalo(1, "2026-08-05T10:00:00-06:00", "2026-08-05T10:20:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(20);
    expect(res.mttr.valorMinutos).toBe(20);
  });

  it("tiempo manual corregido a 60 minutos cuenta 60 aunque la restauración calendario sea menor", () => {
    const res = calcularMTTR(
      [falla({ id: 35724, tareaId: 35724, fechaFallaConfirmada: new Date("2026-08-05T18:39:00.000Z"), fechaRestauracion: new Date("2026-08-05T18:45:00.000Z") })],
      map([
        intervalo(1, "2026-08-05T18:42:08.804Z", "2026-08-05T19:42:08.804Z", 35724),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(60);
    expect(res.mttr.valorMinutos).toBe(60);
  });

  it("dos técnicos trabajando al mismo tiempo durante 60 minutos cuentan 60, no 120", () => {
    const res = calcularMTTR(
      [falla({ fechaFallaConfirmada: new Date("2026-08-05T08:00:00-06:00"), fechaRestauracion: new Date("2026-08-05T09:00:00-06:00") })],
      map([
        intervalo(1, "2026-08-05T08:00:00-06:00", "2026-08-05T09:00:00-06:00"),
        intervalo(2, "2026-08-05T08:00:00-06:00", "2026-08-05T09:00:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(60);
    expect(res.mttr.valorMinutos).toBe(60);
  });

  it("dos intervalos no superpuestos de 30 minutos cuentan 60", () => {
    const res = calcularMTTR(
      [falla({ fechaFallaConfirmada: new Date("2026-08-05T08:00:00-06:00"), fechaRestauracion: new Date("2026-08-05T10:00:00-06:00") })],
      map([
        intervalo(1, "2026-08-05T08:00:00-06:00", "2026-08-05T08:30:00-06:00"),
        intervalo(2, "2026-08-05T09:30:00-06:00", "2026-08-05T10:00:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.sumaMinutosTrabajoTecnico).toBe(60);
    expect(res.mttr.valorMinutos).toBe(60);
  });

  it("fusiona tres intervalos solapados o contiguos", () => {
    const detalle = normalizarIntervalosTecnicosFalla(
      falla({ fechaFallaConfirmada: new Date("2026-08-03T08:00:00-06:00"), fechaRestauracion: new Date("2026-08-03T11:00:00-06:00") }),
      [
        intervalo(1, "2026-08-03T08:00:00-06:00", "2026-08-03T09:00:00-06:00"),
        intervalo(2, "2026-08-03T09:00:00-06:00", "2026-08-03T10:00:00-06:00"),
        intervalo(3, "2026-08-03T09:30:00-06:00", "2026-08-03T11:00:00-06:00"),
      ],
    );
    expect(detalle.intervalosFusionados).toHaveLength(1);
    expect(detalle.tiempoTecnicoActivoMinutos).toBe(180);
  });

  it("excluye intervalo abierto e intervalo con fin anterior a inicio", () => {
    const res = calcularMTTR(
      [falla()],
      map([
        intervalo(1, "2026-08-03T16:30:00-06:00", null),
        intervalo(2, "2026-08-03T18:00:00-06:00", "2026-08-03T17:00:00-06:00"),
      ]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.valorMinutos).toBe(0);
    expect(res.mttr.estado).toBe("MUESTRA_INSUFICIENTE");
    expect(res.mttr.advertencias).toContain("INTERVALO_TECNICO_ABIERTO");
    expect(res.mttr.advertencias).toContain("INTERVALO_TECNICO_INVALIDO");
  });

  it("excluye falla restaurada sin intervalos y falla sin tarea", () => {
    const res = calcularMTTR(
      [falla({ id: 1, tareaId: 101 }), falla({ id: 2, tareaId: null })],
      new Map(),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.fallasInvalidasExcluidas).toBe(2);
    expect(res.mttr.advertencias).toContain("FALLA_RESTAURADA_SIN_INTERVALOS");
    expect(res.mttr.advertencias).toContain("FALLA_SIN_TAREA_VINCULADA");
  });

  it("excluye fallas abiertas del MTTR y conserva advertencia", () => {
    const res = calcularMTTR(
      [falla({ estado: "ABIERTA", fechaRestauracion: null })],
      map([intervalo(1, "2026-08-03T16:30:00-06:00", "2026-08-03T17:30:00-06:00")]),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.valorMinutos).toBe(0);
    expect(res.mttr.fallasAbiertasExcluidas).toBe(1);
    expect(res.mttr.advertencias).toContain("FALLAS_ABIERTAS_EXCLUIDAS_MTTR");
  });

  it("detecta restauración anterior a falla y no genera NaN ni Infinity", () => {
    const res = calcularMTTR(
      [falla({ fechaRestauracion: new Date("2026-08-03T15:00:00-06:00") })],
      new Map(),
      desde,
      hastaEfectivo,
    );
    expect(res.mttr.valorMinutos).toBe(0);
    expect(res.mttr.advertencias).toContain("FECHA_RESTAURACION_INVALIDA");
    expect(JSON.stringify(res)).not.toContain("NaN");
    expect(JSON.stringify(res)).not.toContain("Infinity");
  });
});
