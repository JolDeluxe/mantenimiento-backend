import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mocks
const mockPrisma = {
  usuario: { 
    findUnique: mock((args) => {
      if (args.where.id === 1) return Promise.resolve({ id: 1, rol: "TECNICO", estado: "ACTIVO", username: "tech1" });
      if (args.where.id === 2) return Promise.resolve({ id: 2, rol: "TECNICO", estado: "ACTIVO", username: "tech2" });
      return Promise.resolve(null);
    }),
    findMany: mock(() => Promise.resolve([{ id: 2, rol: "TECNICO", estado: "ACTIVO", username: "tech2" }])),
    update: mock(() => Promise.resolve({ id: 1, estado: "INACTIVO" }))
  },
  reglaRecurrencia: { 
    findMany: mock(() => Promise.resolve([{ id: 10 }])),
    updateMany: mock(() => Promise.resolve()),
    update: mock(() => Promise.resolve())
  },
  reglaActividadRecurrente: {
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve())
  },
  tarea: { 
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve())
  },
  intervaloTiempo: {
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve())
  },
  historialTarea: { create: mock(() => Promise.resolve()) },
  $transaction: mock(async (callback) => {
    return callback(mockPrisma);
  })
};

mock.module("../../db", () => ({
  prisma: mockPrisma
}));

mock.module("../../utils/logger", () => ({
  registrarAccion: mock(() => Promise.resolve()),
  registrarError: mock(() => Promise.resolve())
}));

mock.module("./helper", () => ({
  validarReglasDesactivacion: mock(() => true)
}));

import { changeStatusUsuario, getBajaImpactoUsuario } from "./04_patch";

describe("getBajaImpactoUsuario", () => {
  it("debe retornar el impacto de la baja y los técnicos disponibles", async () => {
    const req = {
      params: { id: "1" }
    };
    let jsonBody = {};
    const res = {
      json: (body: any) => { jsonBody = body; return res; },
      status: () => res
    };
    await getBajaImpactoUsuario(req as any, res as any);
    expect(jsonBody).toHaveProperty("tareasActivas");
    expect(jsonBody).toHaveProperty("actividadesRecurrentes");
    expect(jsonBody).toHaveProperty("mantenimientosRecurrentes");
    expect(jsonBody).toHaveProperty("tecnicosDisponibles");
  });
});

describe("changeStatusUsuario (Baja Técnico)", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("debe exigir reasignaciones si el técnico tiene afectaciones", async () => {
    const req = {
      user: { id: 99, rol: "SUPER_ADMIN" },
      params: { id: 1 },
      body: { estado: "INACTIVO" }
    };
    
    let statusCode = 200;
    let jsonBody = {};
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: any) => { jsonBody = body; return res; }
    };

    await changeStatusUsuario(req as any, res as any);

    expect(statusCode).toBe(409);
    expect(jsonBody).toHaveProperty("error");
    expect((jsonBody as any).error).toContain("Se requiere reasignación");
  });

  it("debe ejecutar la reasignación si se proveen reasignaciones completas", async () => {
    const req = {
      user: { id: 99, rol: "SUPER_ADMIN" },
      params: { id: 1 },
      body: {
        estado: "INACTIVO",
        reasignaciones: {
          tareas: [],
          actividadesRecurrentes: [],
          mantenimientosRecurrentes: [{ reglaId: 10, tecnicoReemplazoId: 2 }]
        }
      }
    };
    
    let statusCode = 200;
    let jsonBody = {};
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: any) => { jsonBody = body; return res; }
    };

    await changeStatusUsuario(req as any, res as any);

    expect(statusCode).toBe(200);
    expect(mockPrisma.usuario.update).toHaveBeenCalled();
  });
});
