// 01_list.ts — Thin Dispatcher
// Delega a los handlers especializados en /list según el contexto de la petición.
// El contrato JSON de respuesta es idéntico en todos los casos.
import type { Request, Response } from "express";
import type { TicketFilterQuery } from "./zod";
import { listarBandeja, listarHoy, listarMantenimientos, listarActividades, listarTodas } from "./list";

export const listarTickets = async (req: Request, res: Response) => {
  const query = req.query as unknown as TicketFilterQuery;
  const scope = query.scope || "general";
  const esHoy = query.perteneceAHoy === true || String(query.perteneceAHoy) === "true";

  if (esHoy) return listarHoy(req, res);

  // Nuevo módulo HOY/ACTIVOS: cada scope tiene handler explícito.
  // list_bandeja.ts queda reservado para Bandeja General y no debe recibir vistas de HOY.
  if (query.vista) {
    if (scope === "mantenimientos") return listarMantenimientos(req, res);
    if (scope === "actividades") return listarActividades(req, res);
    return listarTodas(req, res);
  }

  const esMantto      = !esHoy && query.scope === "mantenimientos";
  const esActividades = !esHoy && query.scope === "actividades";

  if (esMantto)      return listarMantenimientos(req, res);
  if (esActividades) return listarActividades(req, res);
  return listarBandeja(req, res);
};
