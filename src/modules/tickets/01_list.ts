// 01_list.ts — Thin Dispatcher
// Delega a los handlers especializados en /list según el contexto de la petición.
// El contrato JSON de respuesta es idéntico en todos los casos.
import type { Request, Response } from "express";
import type { TicketFilterQuery } from "./zod";
import { listarBandeja, listarHoy, listarMantenimientos, listarActividades } from "./list";

export const listarTickets = async (req: Request, res: Response) => {
  const query = req.query as unknown as TicketFilterQuery;

  const esHoy         = query.perteneceAHoy === true || String(query.perteneceAHoy) === "true";
  const esMantto      = !esHoy && query.scope === "mantenimientos";
  const esActividades = !esHoy && query.scope === "actividades";

  if (esHoy)         return listarHoy(req, res);
  if (esMantto)      return listarMantenimientos(req, res);
  if (esActividades) return listarActividades(req, res);
  return listarBandeja(req, res);
};