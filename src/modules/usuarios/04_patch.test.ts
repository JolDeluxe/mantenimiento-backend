import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mocks
const mockPrisma = {
  usuario: { 
    findUnique: mock((args) => {
      if (args.where.id === 1) return Promise.resolve({ id: 1, rol: "TECNICO", estado: "ACTIVO", username: "tech1" });
      if (args.where.id === 2) return Promise.resolve({ id: 2, rol: "TECNICO", estado: "ACTIVO", username: "tech2" });
      return Promise.resolve(null);
    }),
    update: mock(() => Promise.resolve({ id: 1, estado: "INACTIVO" }))
  },
  reglaRecurrencia: { 
    findMany: mock(() => Promise.resolve([{ id: 10 }])),
    updateMany: mock(() => Promise.resolve())
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
    count: mock(() => Promise.resolve(0))
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

import { changeStatusUsuario } from "./04_patch";

describe("changeStatusUsuario (Baja Técnico)", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("debe exigir tecnicoReemplazoId si el técnico tiene reglas preventivas", async () => {
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
    expect((jsonBody as any).error).toContain("Se requiere un tecnicoReemplazoId");
  });

  it("debe ejecutar la reasignación si se provee tecnicoReemplazoId válido", async () => {
    const req = {
      user: { id: 99, rol: "SUPER_ADMIN" },
      params: { id: 1 },
      body: { estado: "INACTIVO", tecnicoReemplazoId: 2 }
    };
    
    let statusCode = 200;
    let jsonBody = {};
    const res = {
      status: (code: number) => { statusCode = code; return res; },
      json: (body: any) => { jsonBody = body; return res; }
    };

    await changeStatusUsuario(req as any, res as any);

    expect(statusCode).toBe(200);
    expect(mockPrisma.reglaRecurrencia.updateMany).toHaveBeenCalled();
    expect(mockPrisma.usuario.update).toHaveBeenCalled();
  });
});
