import { describe, expect, it } from "bun:test";
import { clasificarTrabajo } from "../calculations/clasificacion";
import { TipoTarea, ClasificacionTarea } from "@prisma/client";

describe("Clasificación de tareas", () => {
  it("excluye tareas autónomas", () => {
    const tarea = {
      tipo: TipoTarea.TICKET,
      clasificacion: ClasificacionTarea.AUTONOMO,
      maquinaId: 1,
    };
    expect(clasificarTrabajo(tarea)).toBeNull();
  });

  it("clasifica como preventivo si tiene máquina y es preventivo", () => {
    const tarea = {
      tipo: TipoTarea.PLANEADA,
      clasificacion: ClasificacionTarea.PREVENTIVO,
      maquinaId: 2,
    };
    expect(clasificarTrabajo(tarea)).toBe("MANTENIMIENTO_PREVENTIVO");
  });

  it("clasifica como correctivo si tiene máquina y es correctivo", () => {
    const tarea = {
      tipo: TipoTarea.TICKET,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      maquinaId: 5,
    };
    expect(clasificarTrabajo(tarea)).toBe("MANTENIMIENTO_CORRECTIVO");
  });

  it("clasifica actividades sin máquina según su tipo", () => {
    expect(
      clasificarTrabajo({ tipo: TipoTarea.TICKET, clasificacion: null, maquinaId: null })
    ).toBe("ACTIVIDAD_REPORTE");

    expect(
      clasificarTrabajo({ tipo: TipoTarea.PLANEADA, clasificacion: null, maquinaId: null })
    ).toBe("ACTIVIDAD_PLANEADA");

    expect(
      clasificarTrabajo({ tipo: TipoTarea.EXTRAORDINARIA, clasificacion: null, maquinaId: null })
    ).toBe("ACTIVIDAD_EXTRAORDINARIA");
  });
});
