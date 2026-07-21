import { Prisma } from "@prisma/client";

export const ticketStandardInclude = {
  creador: {
    select: { 
      id: true, 
      nombre: true, 
      username: true, 
      email: true,
      telefono: true,
      cargo: true,
      imagen: true,
      rol: true,
      departamento: {
        select: {
            nombre: true
        }
      }
    }
  },
  responsables: {
    select: { 
      id: true, 
      nombre: true, 
      username: true, 
      imagen: true,
      cargo: true,
      rol: true
    }
  },
  imagenes: {
    select: {
      id: true,
      url: true,
      tipo: true,
      createdAt: true
    }
  },
  historial: {
    orderBy: { createdAt: 'desc' }, 
    select: {
      id: true,
      tipo: true,
      estadoAnterior: true,
      estadoNuevo: true,
      nota: true,
      createdAt: true,
      usuario: {
        select: {
          id: true,
          nombre: true,
          rol: true,
          imagen: true
        }
      },
      imagenes: {
        select: {
          url: true,
          tipo: true
        }
      }
    }
  },
  intervalos: {
    orderBy: { inicio: 'desc' },
    include: {
        usuario: {
            select: { nombre: true }
        }
    }
  },
  maquina: {
    select: {
      id: true,
      codigo: true,
      nombre: true,
      descripcion: true,
      proceso: true,
      criticidad: true,
      estado: true,
      planta: true,
      area: true,
      ubicacionDetalle: true,
      fechaUltimoServicio: true
    }
  }
} satisfies Prisma.TareaInclude;

export type TicketWithDetails = Omit<Prisma.TareaGetPayload<{
  include: typeof ticketStandardInclude
}>, "maquinaId" | "maquina"> & {
  maquinaId: number | null;
  maquina: Prisma.TareaGetPayload<{
    include: typeof ticketStandardInclude
  }>["maquina"] | null;
};

export type TicketDTO = Omit<TicketWithDetails, "historial"> & {
  fechaProgramada: Date | null;
  isLate: boolean;
  isOverdue: boolean;
  perteneceAHoy: boolean;
  diasEnEspera: number;
  historial: (TicketWithDetails["historial"][number] & {
    esTiempoManual: boolean;
  })[];
};

export interface CreateTicketClientResolvedDTO {
  categoria: string;
  incidenteId: string;
  titulo: string;
  prioridad: import("@prisma/client").Prioridad;
  descripcion: string;
  planta: string;
  area: string;
  maquinaId: number | null;
  paroProduccion: boolean;
  fechaParoProduccion: Date | null;
}

