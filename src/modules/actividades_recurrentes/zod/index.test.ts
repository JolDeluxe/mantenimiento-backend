import { describe, expect, test } from "bun:test";
import { Prioridad, UnidadRecurrenciaActividad } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  cambiarActivoSchema,
  createReglaActividadSchema,
  materializarActividadSchema,
  moverOcurrenciaActividadSchema,
  omitirOcurrenciaActividadSchema,
  quitarAjusteActividadSchema,
  updateReglaActividadSchema,
} from "./index";
import { esErrorConcurrenciaDeCiclo, esErrorUnicoDeCiclo } from "../materialize-core";

const empty = { params: {}, query: {} };

describe("contratos Zod de actividades recurrentes", () => {
  test("acepta una regla sin responsables y horario válido", () => {
    const result = createReglaActividadSchema.parse({
      ...empty,
      body: {
        titulo: "Inspección de seguridad",
        descripcion: null,
        categoria: "GESTION",
        planta: null,
        area: "ACABADO",
        prioridad: Prioridad.MEDIA,
        fechaInicio: "2026-08-01",
        fechaFin: null,
        horaInicio: "08:00",
        horaFin: "09:30",
        tiempoEstimado: null,
        unidad: UnidadRecurrenciaActividad.SEMANA,
        intervalo: 2,
        responsables: [],
      },
    });
    expect(result.body.responsables).toEqual([]);
  });

  test("rechaza horas parciales, invertidas y duración ausente", () => {
    const base = {
      titulo: "Inspección de seguridad",
      categoria: "GESTION",
      area: "ACABADO",
      fechaInicio: "2026-08-01",
      unidad: UnidadRecurrenciaActividad.DIA,
      intervalo: 1,
      responsables: [],
    };
    expect(() => createReglaActividadSchema.parse({ ...empty, body: { ...base, horaInicio: "08:00" } })).toThrow();
    expect(() => createReglaActividadSchema.parse({ ...empty, body: { ...base, horaInicio: "09:00", horaFin: "08:00" } })).toThrow();
    expect(() => createReglaActividadSchema.parse({ ...empty, body: base })).toThrow();
  });

  test("valida mutaciones de ciclo y estado", () => {
    expect(materializarActividadSchema.parse({ params: { id: "4" }, query: {}, body: { fechaCicloLogica: "2026-08-01", confirmarFuturo: false } }).params.id).toBe(4);
    expect(moverOcurrenciaActividadSchema.parse({ params: { id: "4" }, query: {}, body: { fechaOriginal: "2026-08-01", fechaNueva: "2026-08-03" } }).body.fechaNueva).toBe("2026-08-03");
    expect(omitirOcurrenciaActividadSchema.parse({ params: { id: "4" }, query: {}, body: { fechaOriginal: "2026-08-01", motivo: "Paro de operación" } }).body.motivo).toBe("Paro de operación");
    expect(quitarAjusteActividadSchema.parse({ params: { id: "4" }, query: {}, body: { fechaOriginal: "2026-08-01" } }).body.fechaOriginal).toBe("2026-08-01");
    expect(cambiarActivoSchema.parse({ params: { id: "4" }, query: {}, body: { activo: false } }).body.activo).toBe(false);
  });

  test("rechaza propiedades inesperadas y reconoce P2002 como idempotencia", () => {
    expect(() => materializarActividadSchema.parse({ params: { id: "4" }, query: {}, body: { extra: true } })).toThrow();
    const duplicate = new Prisma.PrismaClientKnownRequestError("Duplicado", { code: "P2002", clientVersion: "5.22.0" });
    expect(esErrorUnicoDeCiclo(duplicate)).toBe(true);
    const deadlock = new Prisma.PrismaClientKnownRequestError("Deadlock", { code: "P2034", clientVersion: "5.22.0" });
    expect(esErrorConcurrenciaDeCiclo(duplicate)).toBe(true);
    expect(esErrorConcurrenciaDeCiclo(deadlock)).toBe(true);
  });

  test("rechaza campos inmutables y actualizaciones vacías", () => {
    const request = { params: { id: "4" }, query: {}, body: { titulo: "Título actualizado" } };
    expect(updateReglaActividadSchema.parse(request).body.titulo).toBe("Título actualizado");
    expect(() => updateReglaActividadSchema.parse({ ...request, body: {} })).toThrow();
    for (const field of ["fechaInicio", "unidad", "intervalo", "proximaFechaEjecucion", "creadorId", "archivadoAt", "createdAt", "updatedAt"]) {
      expect(() => updateReglaActividadSchema.parse({ ...request, body: { [field]: "2026-01-01" } })).toThrow();
    }
  });
});
