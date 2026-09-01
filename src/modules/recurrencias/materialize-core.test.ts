import { describe, expect, test } from "bun:test";
import { ClasificacionTarea, EstadoTarea, Prisma, Prioridad, TipoTarea } from "@prisma/client";
import { materializarCicloInterno } from "./02_create";

const fecha = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("materialización de recurrencias preventivas", () => {
  test("la tarea generada hereda los datos reales de la regla y del ajuste aplicado", async () => {
    const regla = {
      id: 88,
      maquinaId: 501,
      titulo: "Cambio de filtro hidráulico",
      descripcion: "Sustituir filtro y validar presión",
      categoria: "HIDRAULICA",
      prioridad: Prioridad.ALTA,
      tiempoEstimado: 120,
      tecnicoResponsableId: 33,
    };
    const creaciones: Array<Record<string, unknown>> = [];
    const fakeDb = {
      tarea: {
        create: async ({ data, select }: { data: Record<string, unknown>; select: Record<string, boolean> }) => {
          creaciones.push(data);
          return Object.fromEntries(Object.keys(select).map((key) => [key, key === "id" ? 700 : data[key]]));
        },
        findFirst: async () => null,
      },
    } as never;

    const ticket = await materializarCicloInterno({
      regla,
      fechaCicloLogica: fecha("2026-08-31"),
      fechaProgramadaPreventiva: fecha("2026-09-01"),
      maquinaPlanta: "PLANTA 1",
      maquinaArea: "PREMONTADO",
      creadorId: 9,
    }, fakeDb);

    expect(creaciones).toHaveLength(1);
    expect(creaciones[0]).toMatchObject({
      tipo: TipoTarea.PLANEADA,
      clasificacion: ClasificacionTarea.PREVENTIVO,
      titulo: "Cambio de filtro hidráulico",
      descripcion: "Sustituir filtro y validar presión",
      categoria: "HIDRAULICA",
      prioridad: Prioridad.ALTA,
      planta: "PLANTA 1",
      area: "PREMONTADO",
      estado: EstadoTarea.ASIGNADA,
      maquinaId: 501,
      creadorId: 9,
      tiempoEstimado: 120,
      reglaRecurrenciaId: 88,
      responsables: { connect: [{ id: 33 }] },
    });
    expect((creaciones[0]!.fechaCicloLogica as Date).toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect((creaciones[0]!.fechaProgramadaPreventiva as Date).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect((creaciones[0]!.fechaVencimiento as Date).toISOString()).toBe("2026-08-31T23:59:59.999Z");
    expect(ticket).toMatchObject({
      id: 700,
      titulo: "Cambio de filtro hidráulico",
      estado: EstadoTarea.ASIGNADA,
      reglaRecurrenciaId: 88,
    });
  });

  test("si el ciclo ya existe por concurrencia, devuelve la tarea existente sin duplicar", async () => {
    const regla = {
      id: 88,
      maquinaId: 501,
      titulo: "Cambio de filtro hidráulico",
      descripcion: "Sustituir filtro y validar presión",
      categoria: "HIDRAULICA",
      prioridad: Prioridad.ALTA,
      tiempoEstimado: 120,
      tecnicoResponsableId: 33,
    };
    let intentosCrear = 0;
    const existente = {
      id: 701,
      titulo: regla.titulo,
      estado: EstadoTarea.ASIGNADA,
      fechaVencimiento: fecha("2026-08-31"),
      fechaCicloLogica: fecha("2026-08-31"),
      fechaProgramadaPreventiva: null,
      reglaRecurrenciaId: regla.id,
    };
    const fakeDb = {
      tarea: {
        create: async () => {
          intentosCrear++;
          throw new Prisma.PrismaClientKnownRequestError("Duplicado", { code: "P2002", clientVersion: "5.22.0" });
        },
        findFirst: async () => existente,
      },
    } as never;

    const ticket = await materializarCicloInterno({
      regla,
      fechaCicloLogica: fecha("2026-08-31"),
      maquinaPlanta: "PLANTA 1",
      maquinaArea: "PREMONTADO",
      creadorId: 9,
    }, fakeDb);

    expect(intentosCrear).toBe(1);
    expect(ticket).toEqual(existente);
  });

  test("dos ejecuciones equivalentes del cron no crean dos tareas para la misma deuda", async () => {
    const regla = {
      id: 89,
      maquinaId: 502,
      titulo: "Mantenimiento mensual",
      descripcion: "Revisión completa",
      categoria: "MAQUINARIA",
      prioridad: Prioridad.MEDIA,
      tiempoEstimado: 60,
      tecnicoResponsableId: 34,
    };
    const tareas = new Map<string, Record<string, unknown>>();
    const fakeDb = {
      tarea: {
        create: async ({ data, select }: { data: Record<string, unknown>; select: Record<string, boolean> }) => {
          const key = `${data.reglaRecurrenciaId}_${(data.fechaCicloLogica as Date).toISOString()}`;
          if (tareas.has(key)) {
            throw new Prisma.PrismaClientKnownRequestError("Duplicado", { code: "P2002", clientVersion: "5.22.0" });
          }
          const ticket = Object.fromEntries(Object.keys(select).map((field) => [field, field === "id" ? 800 : data[field]]));
          tareas.set(key, ticket);
          return ticket;
        },
        findFirst: async ({ where }: { where: { reglaRecurrenciaId: number; fechaCicloLogica: Date } }) => {
          const key = `${where.reglaRecurrenciaId}_${where.fechaCicloLogica.toISOString()}`;
          return tareas.get(key) ?? null;
        },
      },
    } as never;

    const params = {
      regla,
      fechaCicloLogica: fecha("2026-08-31"),
      maquinaPlanta: "PLANTA 1",
      maquinaArea: "PREMONTADO",
      creadorId: 9,
    };
    const primero = await materializarCicloInterno(params, fakeDb);
    const segundo = await materializarCicloInterno(params, fakeDb);

    expect(tareas.size).toBe(1);
    expect(primero?.id).toBe(800);
    expect(segundo?.id).toBe(800);
  });
});
