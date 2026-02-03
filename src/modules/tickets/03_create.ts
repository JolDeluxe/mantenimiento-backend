import type { Request, Response } from "express";
import { isAdminOrJefe, isTecnico } from "./helper";
import { createTicketAdmin } from "./create/create_admin";
import { createTicketCliente } from "./create/create_cliente";

export const createTicket = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    if (isTecnico(user.rol)) {
      return res.status(403).json({ 
        error: "Acceso denegado." 
      });
    }

    if (isAdminOrJefe(user.rol)) {
      return createTicketAdmin(req, res);
    } 
    
    else { 
      return createTicketCliente(req, res);
    }

  } catch (error) {
    console.error("Error en dispatcher de creación:", error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};