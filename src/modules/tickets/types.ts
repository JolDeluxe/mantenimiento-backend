import { Prisma } from "@prisma/client";

export const ticketStandardInclude = {
  creador: {
    select: { 
      id: true, 
      nombre: true, 
      username: true, 
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
  }
} satisfies Prisma.TareaInclude;

export type TicketWithDetails = Prisma.TareaGetPayload<{
  include: typeof ticketStandardInclude
}>;