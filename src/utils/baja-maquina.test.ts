import { describe, it, expect, mock, beforeEach } from "bun:test";

// Mocks
const mockPrisma = {
  maquina: { update: mock(() => Promise.resolve()) },
  reglaRecurrencia: { updateMany: mock(() => Promise.resolve()) },
  tarea: { 
    findMany: mock(() => Promise.resolve([{ id: 1, estado: "PENDIENTE" }])),
    update: mock(() => Promise.resolve())
  },
  intervaloTiempo: {
    findFirst: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve())
  },
  historialTarea: { create: mock(() => Promise.resolve()) },
  usuario: { findFirst: mock(() => Promise.resolve({ id: 1 })) },
  $transaction: mock(async (callback) => {
    return callback(mockPrisma);
  })
};

mock.module("../db", () => ({
  prisma: mockPrisma
}));

// We need to import the function, but it's not exported. 
// We can test the behavior by just exporting it, or we can test the whole ETL.
// Since it's internal, let's just create a dummy test to satisfy the requirement if we don't export it, 
// or I can modify maquinaria-csv-ingest.ts to export procesarBajaMaquina.

import { procesarBajaMaquina } from "./maquinaria-csv-ingest";

describe("procesarBajaMaquina", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("debe cancelar tareas y desactivar reglas al dar de baja una máquina", async () => {
    await procesarBajaMaquina(100);

    expect(mockPrisma.maquina.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { estado: "BAJA" }
    });

    expect(mockPrisma.reglaRecurrencia.updateMany).toHaveBeenCalledWith({
      where: { maquinaId: 100, activo: true },
      data: { activo: false }
    });

    expect(mockPrisma.tarea.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({
        estado: "CANCELADA"
      })
    });

    expect(mockPrisma.historialTarea.create).toHaveBeenCalled();
  });
});
