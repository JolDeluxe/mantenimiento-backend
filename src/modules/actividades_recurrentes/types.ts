import { Prisma } from "@prisma/client";

export const reglaActividadInclude = {
  creador: { select: { id: true, nombre: true, username: true } },
  responsables: { select: { id: true, nombre: true, username: true, email: true, estado: true, rol: true } },
} satisfies Prisma.ReglaActividadRecurrenteInclude;

export type ReglaActividadConRelaciones = Prisma.ReglaActividadRecurrenteGetPayload<{
  include: typeof reglaActividadInclude;
}>;

export type ProyeccionActividad = {
  reglaId: number;
  fechaCicloLogica: string;
  fechaOriginal: string;
  fechaProgramada: string;
  ajusteTipo: "MOVER" | "OMITIR" | null;
  motivo: string | null;
  omitida: boolean;
  movida: boolean;
  pendienteMaterializar: boolean;
  tareaId: number | null;
  tareaEstado: string | null;
};
