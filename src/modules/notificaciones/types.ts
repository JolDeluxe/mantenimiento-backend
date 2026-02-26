import type { Tarea, Usuario } from "@prisma/client";

export interface NotificationPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

export interface PayloadBase {
  titulo: string;
  cuerpo: string;
  url: string;
}

// Tipo extendido para asegurar que la tarea traiga sus relaciones necesarias
export type TareaConRelaciones = Tarea & {
  creador?: Usuario | null;
  responsables?: Usuario[];
};