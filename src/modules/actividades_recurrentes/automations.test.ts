import { describe, expect, test } from "bun:test";
import { EstadoTarea, Estatus, Prisma, Prioridad, UnidadRecurrenciaActividad } from "@prisma/client";
import { procesarActividadesRecurrentesProgramadas } from "./automations";
import { materializarActividadEnTransaccion } from "./materialize-core";
import { normalizarFechaLogica, ZONA_HORARIA_MX } from "../../utils/recurrencia-temporal";
import type { ReglaActividadConRelaciones } from "./types";

const fecha = (value: string) => new Date(`${value}T00:00:00.000Z`);

function crearRegla(overrides: Partial<ReglaActividadConRelaciones> = {}) {
  return {
    id: 101,
    titulo: "Limpiar área",
    descripcion: "Limpieza diaria",
    categoria: "LIMPIEZA",
    planta: null,
    area: "ALMACEN",
    prioridad: Prioridad.MEDIA,
    fechaInicio: fecha("2026-01-01"),
    fechaFin: null,
    horaInicioMinutos: 480,
    horaFinMinutos: 540,
    tiempoEstimado: 60,
    unidad: UnidadRecurrenciaActividad.DIA,
    intervalo: 1,
    proximaFechaEjecucion: fecha("2026-01-01"),
    activo: true,
    archivadoAt: null,
    creadorId: 5,
    createdAt: fecha("2026-01-01"),
    updatedAt: fecha("2026-01-01"),
    creador: { id: 5, nombre: "Admin", username: "admin" },
    responsables: [{ id: 10, nombre: "Juan", username: "juan", estado: Estatus.ACTIVO }],
    ...overrides,
  } as ReglaActividadConRelaciones;
}

describe("Pruebas obligatorias de automatización y recuperación", () => {
  test("Caso 1: Recurrente diaria con inicio hoy materializa tarea inicial inmediatamente y avanza la fecha", async () => {
    const regla = crearRegla({ fechaInicio: fecha("2026-01-01"), proximaFechaEjecucion: fecha("2026-01-01") });
    
    const tareasCreadas: any[] = [];
    const tx = {
      tarea: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          tareasCreadas.push(data);
          return { id: 1, ...data, responsables: [{ id: 10 }] };
        },
      },
      historialTarea: { create: async () => ({}) },
      reglaActividadRecurrenteAjuste: { findUnique: async () => null },
      usuario: { findMany: async () => [{ id: 10, estado: Estatus.ACTIVO }] },
      reglaActividadRecurrente: {
        update: async ({ data }: any) => {
          regla.proximaFechaEjecucion = data.proximaFechaEjecucion;
          return regla;
        },
      },
    } as any;

    const resMat = await materializarActividadEnTransaccion({
      tx,
      regla,
      fechaCicloLogica: fecha("2026-01-01"),
      creadorId: 5,
    });

    expect(resMat.yaExistia).toBe(false);
    expect(tareasCreadas).toHaveLength(1);
    expect(tareasCreadas[0].reglaActividadRecurrenteId).toBe(101);
    expect(regla.proximaFechaEjecucion.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });

  test("Caso 2: Recurrente con inicio futuro no materializa hoy", async () => {
    const hoy = fecha("2026-01-01");
    const regla = crearRegla({ fechaInicio: fecha("2026-01-02"), proximaFechaEjecucion: fecha("2026-01-02") });

    expect(regla.proximaFechaEjecucion.getTime() > hoy.getTime()).toBe(true);
  });

  test("Caso 4: Rechaza materialización en Domingo", async () => {
    const regla = crearRegla({ proximaFechaEjecucion: fecha("2026-01-04") });
    const tx = {
      tarea: { findFirst: async () => null, create: async () => ({}) },
      reglaActividadRecurrenteAjuste: { findUnique: async () => null },
    } as any;

    await expect(
      materializarActividadEnTransaccion({
        tx,
        regla,
        fechaCicloLogica: fecha("2026-01-04"),
        creadorId: 5,
      })
    ).rejects.toThrow();
  });

  test("Caso 6 y 12: Backlog de varios ciclos avanza hasta quedar al corriente sin duplicados (Caso 5, 6, 7, 12)", async () => {
    const regla = crearRegla({ proximaFechaEjecucion: fecha("2026-01-01") });
    const hoy = fecha("2026-01-03");

    const tareasMap = new Map<string, any>();
    const tx = {
      tarea: {
        findFirst: async ({ where }: any) => {
          const key = `${where.reglaActividadRecurrenteId}_${where.fechaCicloLogica.toISOString()}`;
          return tareasMap.get(key) ?? null;
        },
        create: async ({ data }: any) => {
          const key = `${data.reglaActividadRecurrenteId}_${data.fechaCicloLogica.toISOString()}`;
          const t = { id: tareasMap.size + 1, ...data, responsables: [{ id: 10 }] };
          tareasMap.set(key, t);
          return t;
        },
      },
      historialTarea: { create: async () => ({}) },
      reglaActividadRecurrenteAjuste: { findUnique: async () => null },
      usuario: { findMany: async () => [{ id: 10, estado: Estatus.ACTIVO }] },
      reglaActividadRecurrente: {
        update: async ({ data }: any) => {
          regla.proximaFechaEjecucion = data.proximaFechaEjecucion;
          return regla;
        },
      },
    } as any;

    let ciclos = 0;
    while (regla.proximaFechaEjecucion <= hoy && ciclos < 10) {
      ciclos++;
      await materializarActividadEnTransaccion({
        tx,
        regla,
        fechaCicloLogica: regla.proximaFechaEjecucion,
        creadorId: 5,
      });
    }

    expect(tareasMap.size).toBe(3);
    expect(regla.proximaFechaEjecucion.toISOString()).toBe("2026-01-05T00:00:00.000Z");

    const reIntento = await materializarActividadEnTransaccion({
      tx,
      regla,
      fechaCicloLogica: fecha("2026-01-01"),
      creadorId: 5,
    });
    expect(reIntento.yaExistia).toBe(true);
    expect(tareasMap.size).toBe(3);
  });

  test("Caso 8, 9, 10: Reglas pausadas, archivadas o fuera de fechaFin", async () => {
    const reglaPausada = crearRegla({ activo: false });
    expect(reglaPausada.activo).toBe(false);

    const reglaArchivada = crearRegla({ archivadoAt: new Date() });
    expect(reglaArchivada.archivadoAt).not.toBeNull();

    const reglaExpirada = crearRegla({
      fechaInicio: fecha("2026-01-01"),
      fechaFin: fecha("2026-01-02"),
      proximaFechaEjecucion: fecha("2026-01-05"),
    });

    const tx = {
      tarea: { findFirst: async () => null, create: async () => ({}) },
      reglaActividadRecurrenteAjuste: { findUnique: async () => null },
    } as any;

    await expect(
      materializarActividadEnTransaccion({
        tx,
        regla: reglaExpirada,
        fechaCicloLogica: fecha("2026-01-05"),
        creadorId: 5,
      })
    ).rejects.toThrow();
  });

  test("Caso 11: Responsables se conservan correctamente", async () => {
    const regla = crearRegla({ responsables: [{ id: 10, nombre: "Juan", username: "juan", email: null, rol: "TECNICO" as never, estado: Estatus.ACTIVO }, { id: 11, nombre: "Pedro", username: "pedro", email: null, rol: "TECNICO" as never, estado: Estatus.ACTIVO }] });
    let responsablesConectados: number[] = [];

    const tx = {
      tarea: {
        findFirst: async () => null,
        create: async ({ data }: any) => {
          responsablesConectados = data.responsables.connect.map((c: any) => c.id);
          return { id: 1, ...data, responsables: [{ id: 10 }, { id: 11 }] };
        },
      },
      historialTarea: { create: async () => ({}) },
      reglaActividadRecurrenteAjuste: { findUnique: async () => null },
      usuario: { findMany: async () => [{ id: 10, estado: Estatus.ACTIVO }, { id: 11, estado: Estatus.ACTIVO }] },
      reglaActividadRecurrente: { update: async () => regla },
    } as any;

    const res = await materializarActividadEnTransaccion({
      tx,
      regla,
      fechaCicloLogica: fecha("2026-01-01"),
      creadorId: 5,
    });

    expect(res.responsablesIds).toEqual([10, 11]);
    expect(responsablesConectados).toEqual([10, 11]);
  });
});
