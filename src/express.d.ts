import { Usuario, Rol } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        rol: Rol;
        departamentoId?: number | null;
        email: string;
      };
    }
  }
}

export {};