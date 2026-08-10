import { ClasificacionTarea, TipoTarea } from "@prisma/client";
import type { BucketTrabajo, TareaClasificable } from "../types";

export function clasificarTrabajo(tarea: TareaClasificable): BucketTrabajo | null {
  if (tarea.clasificacion === ClasificacionTarea.AUTONOMO) {
    return null;
  }

  if (tarea.maquinaId != null) {
    if (tarea.clasificacion === ClasificacionTarea.PREVENTIVO) return "MANTENIMIENTO_PREVENTIVO";
    if (tarea.clasificacion === ClasificacionTarea.CORRECTIVO) return "MANTENIMIENTO_CORRECTIVO";
    return null;
  }

  if (tarea.tipo === TipoTarea.TICKET) return "ACTIVIDAD_REPORTE";
  if (tarea.tipo === TipoTarea.PLANEADA) return "ACTIVIDAD_PLANEADA";
  if (tarea.tipo === TipoTarea.EXTRAORDINARIA) return "ACTIVIDAD_EXTRAORDINARIA";

  return null;
}
