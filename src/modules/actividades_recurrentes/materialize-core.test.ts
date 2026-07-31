import { describe, expect, test } from "bun:test";
import { EstadoTarea, Estatus, Prisma, Prioridad, TipoAjusteRecurrencia, UnidadRecurrenciaActividad } from "@prisma/client";
import { ActividadRecurrenteError } from "./helper";
import { materializarActividadEnTransaccion } from "./materialize-core";
import type { ReglaActividadConRelaciones } from "./types";

const fecha = (value: string) => new Date(`${value}T00:00:00.000Z`);

function crearRegla(overrides: Partial<ReglaActividadConRelaciones> = {}) {
  return {
    id: 71,
    titulo: "Inspección de seguridad",
    descripcion: "Revisión recurrente",
    categoria: "GESTION",
    planta: null,
    area: "ACABADO",
    prioridad: Prioridad.ALTA,
    fechaInicio: fecha("2026-01-01"),
    fechaFin: fecha("2026-01-31"),
    horaInicioMinutos: 480,
    horaFinMinutos: 570,
    tiempoEstimado: 90,
    unidad: UnidadRecurrenciaActividad.DIA,
    intervalo: 1,
    proximaFechaEjecucion: fecha("2026-01-03"),
    activo: true,
    archivadoAt: null,
    creadorId: 9,
    createdAt: fecha("2026-01-01"),
    updatedAt: fecha("2026-01-01"),
    creador: { id: 9, nombre: "Coordinador", username: "coord" },
    responsables: [],
    ...overrides,
  } as ReglaActividadConRelaciones;
}

function crearTx(regla: ReglaActividadConRelaciones, options: {
  ajuste?: { tipo: TipoAjusteRecurrencia; fechaNueva: Date | null; motivo: string | null; activo?: boolean } | null;
  responsablesActivos?: number[];
  falloDuplicado?: boolean;
} = {}) {
  const tareas: Array<Record<string, unknown>> = [];
  const creaciones: Array<Record<string, unknown>> = [];
  const historial: Array<Record<string, unknown>> = [];
  const actualizacionesCursor: Array<Record<string, unknown>> = [];
  const tx = {
    reglaActividadRecurrenteAjuste: {
      findUnique: async () => options.ajuste ? { ...options.ajuste, activo: options.ajuste.activo ?? true } : null,
    },
    tarea: {
      findFirst: async ({ where }: { where: { fechaCicloLogica: Date } }) => tareas.find((tarea) => (tarea.fechaCicloLogica as Date).getTime() === where.fechaCicloLogica.getTime()) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.falloDuplicado) throw new Prisma.PrismaClientKnownRequestError("Duplicado", { code: "P2002", clientVersion: "5.22.0" });
        creaciones.push(data);
        const responsables = ((data.responsables as { connect: Array<{ id: number }> }).connect).map(({ id }) => ({ id }));
        const tarea = { id: tareas.length + 1, ...data, responsables };
        tareas.push(tarea);
        return tarea;
      },
    },
    usuario: {
      findMany: async () => (options.responsablesActivos ?? regla.responsables.map((responsable) => responsable.id)).map((id) => ({ id, estado: Estatus.ACTIVO })),
    },
    historialTarea: { create: async ({ data }: { data: Record<string, unknown> }) => { historial.push(data); return data; } },
    reglaActividadRecurrente: {
      update: async ({ data }: { data: { proximaFechaEjecucion: Date } }) => {
        actualizacionesCursor.push(data);
        regla.proximaFechaEjecucion = data.proximaFechaEjecucion;
        return regla;
      },
    },
  };
  return { tx: tx as never, tareas, creaciones, historial, actualizacionesCursor };
}

describe("materialización de actividades recurrentes", () => {
  test("materializa una tarea PENDIENTE sin responsables con los campos de actividad", async () => {
    const regla = crearRegla();
    const fake = crearTx(regla);
    const result = await materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });

    expect(result.yaExistia).toBe(false);
    expect(fake.tareas).toHaveLength(1);
    expect(fake.tareas[0]).toMatchObject({
      tipo: "PLANEADA",
      clasificacion: null,
      maquinaId: null,
      reglaRecurrenciaId: null,
      reglaActividadRecurrenteId: 71,
      estado: EstadoTarea.PENDIENTE,
    });
    expect((fake.tareas[0]!.fechaCicloLogica as Date).toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(fake.historial).toHaveLength(1);
    expect(fake.actualizacionesCursor).toHaveLength(1);
    expect((fake.actualizacionesCursor[0]!.proximaFechaEjecucion as Date).toISOString()).toBe("2026-01-05T00:00:00.000Z");
  });

  test("materializa ASIGNADA y copia responsables como snapshot", async () => {
    const regla = crearRegla({ responsables: [{ id: 22, nombre: "Técnico", username: "tec", email: "tec@example.test", estado: Estatus.ACTIVO, rol: "TECNICO" as never }] });
    const fake = crearTx(regla, { responsablesActivos: [22] });
    const result = await materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });

    expect(result.responsablesIds).toEqual([22]);
    expect(fake.tareas[0]!.estado).toBe(EstadoTarea.ASIGNADA);
    expect(fake.creaciones[0]!.responsables).toEqual({ connect: [{ id: 22 }] });
    expect(fake.tareas[0]!.responsables).toEqual([{ id: 22 }]);
  });

  test("resuelve mover, omitir e idempotencia sin corromper el cursor", async () => {
    const movida = crearRegla();
    const moverTx = crearTx(movida, { ajuste: { tipo: TipoAjusteRecurrencia.MOVER, fechaNueva: fecha("2026-01-05"), motivo: "Paro" } });
    const moved = await materializarActividadEnTransaccion({ tx: moverTx.tx, regla: movida, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });
    expect(moved.fechaEfectiva?.toISOString()).toBe("2026-01-05T00:00:00.000Z");
    expect((moverTx.tareas[0]!.fechaCicloLogica as Date).toISOString()).toBe("2026-01-03T00:00:00.000Z");

    const omitida = crearRegla();
    const omitirTx = crearTx(omitida, { ajuste: { tipo: TipoAjusteRecurrencia.OMITIR, fechaNueva: null, motivo: "Paro" } });
    const skipped = await materializarActividadEnTransaccion({ tx: omitirTx.tx, regla: omitida, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });
    expect(skipped.omitida).toBe(true);
    expect(omitirTx.tareas).toHaveLength(0);
    expect((omitirTx.actualizacionesCursor[0]!.proximaFechaEjecucion as Date).toISOString()).toBe("2026-01-05T00:00:00.000Z");

    const existente = crearRegla();
    const existingTx = crearTx(existente);
    await materializarActividadEnTransaccion({ tx: existingTx.tx, regla: existente, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });
    const repeated = await materializarActividadEnTransaccion({ tx: existingTx.tx, regla: existente, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 });
    expect(repeated.yaExistia).toBe(true);
    expect(existingTx.tareas).toHaveLength(1);
    expect(existingTx.actualizacionesCursor).toHaveLength(1);
  });

  test("no adelanta el cursor para ciclos históricos, futuros o fuera de vigencia", async () => {
    const regla = crearRegla();
    const fake = crearTx(regla);
    await materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-02"), creadorId: 9 });
    await materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-05"), creadorId: 9 });
    expect(fake.actualizacionesCursor).toHaveLength(0);
    await expect(materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-02-01"), creadorId: 9 })).rejects.toBeInstanceOf(ActividadRecurrenteError);
    expect(fake.actualizacionesCursor).toHaveLength(0);
  });

  test("rechaza materializar domingos aunque coincidan con el patrón calendario", async () => {
    const regla = crearRegla();
    const fake = crearTx(regla);
    await expect(materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-04"), creadorId: 9 })).rejects.toBeInstanceOf(ActividadRecurrenteError);
    expect(fake.tareas).toHaveLength(0);
    expect(fake.actualizacionesCursor).toHaveLength(0);
  });

  test("propaga P2002 para que el controlador recupere la tarea ganadora", async () => {
    const regla = crearRegla();
    const fake = crearTx(regla, { falloDuplicado: true });
    await expect(materializarActividadEnTransaccion({ tx: fake.tx, regla, fechaCicloLogica: fecha("2026-01-03"), creadorId: 9 })).rejects.toMatchObject({ code: "P2002" });
    expect(fake.historial).toHaveLength(0);
  });
});
