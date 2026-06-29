// 04_update.ts — Thin Dispatcher
// Detecta el rol del usuario y delega la lógica al handler correspondiente.
// Contrato JSON de respuesta: { message: string, data: TareaWithDetails }
import type { Request, Response } from "express";
import { Rol } from "@prisma/client";
import { isAdminOrJefe } from "./helper";
import { updateTicketAdmin, updateTicketCliente } from "./update";

export const updateTicket = async (req: Request, res: Response) => {
  const user = req.user!;

  if (isAdminOrJefe(user.rol)) return updateTicketAdmin(req, res);
  if (user.rol === Rol.CLIENTE_INTERNO) return updateTicketCliente(req, res);

  return res.status(403).json({ error: "No tienes permisos para editar esta tarea." });
};