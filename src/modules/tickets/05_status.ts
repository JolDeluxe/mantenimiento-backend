// 05_status.ts — Thin Dispatcher
// Detecta el rol y delega al handler especializado.
// Contrato JSON de respuesta: { message: string, data: Tarea }
import type { Request, Response } from "express";
import { Rol } from "@prisma/client";
import { isAdminOrJefe } from "./helper";
import { changeStatusTecnico, changeStatusCliente, changeStatusAdmin } from "./status";

export const changeTicketStatus = async (req: Request, res: Response) => {
  const user = req.user!;

  if (user.rol === Rol.TECNICO)         return changeStatusTecnico(req, res);
  if (user.rol === Rol.CLIENTE_INTERNO) return changeStatusCliente(req, res);
  if (isAdminOrJefe(user.rol))          return changeStatusAdmin(req, res);

  return res.status(403).json({ error: "No tienes permisos para cambiar el estatus." });
};