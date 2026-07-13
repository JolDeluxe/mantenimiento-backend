// src/modules/recurrencias/types.ts
import { Prisma } from "@prisma/client";

export type ReglaRecurrenciaWithRelations = Prisma.ReglaRecurrenciaGetPayload<{
  include: {
    maquina: { select: { id: true; codigo: true; nombre: true; planta: true; area: true } };
    tecnicoResponsable: { select: { id: true; nombre: true; username: true; email: true } };
  };
}>;

/** Proyección virtual: ciclo futuro que AÚN no tiene ticket real en BD */
export interface ProyeccionCiclo {
  reglaId:          number;
  maquinaId:        number;
  maquinaCodigo:    string;
  maquinaNombre:    string;
  tecnicoId:        number;
  tecnicoNombre:    string;
  titulo:           string;
  categoria:        string;
  prioridad:        string;
  frecuencia:       string;
  /** Fecha lógica pura del ciclo (sin ajuste de fin de semana) */
  fechaCicloLogica: Date;
  fechaCicloLogicaFormateada: string; // Formato YYYY-MM-DD para frontend
  fechaOriginal: Date;
  fechaOriginalFormateada: string;
  fechaProgramada: Date;
  fechaProgramadaFormateada: string;
  fechaProgramadaPreventiva: Date | null;
  fechaProgramadaPreventivaFormateada: string | null;
  ajusteTipo: "MOVER" | "OMITIR" | null;
  ajusteMotivo: string | null;
  omitida: boolean;
  movida: boolean;
  movidaDesde: string | null;
  movidaA: string | null;
  /** Fecha física sugerida para ejecución (ajustada por fin de semana) */
  fechaVencimientoSugerida: Date;
  fechaVencimientoSugeridaFormateada: string; // Formato YYYY-MM-DD para frontend
  /** true = aún no existe ticket para esta regla + fechaCicloLogica */
  pendienteMaterializar: boolean;
}
