import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { ticketStandardInclude } from "./types"; 
import { checkTicketExpiration } from "./expiration";

export const getTicket = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user!; 
    const ticketId = Number(id);

    if (isNaN(ticketId)) {
      return res.status(400).json({ error: "ID de ticket inválido" });
    }

    // 1. Buscamos en BD
    const ticketDB = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: ticketStandardInclude
    });

    if (!ticketDB) {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    // 2. Procesamos Expiración (6 meses)
    // Esto nos devuelve el ticket limpio o el original, pero nunca null
    const protocol = req.protocol;
    const host = req.get('host');
    const fullUrlHost = `${protocol}://${host}`;
    
    const ticket = await checkTicketExpiration(ticketDB, fullUrlHost);

    // 3. Validar Permisos
    let tienePermiso = false;
    const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
    
    if (rolesAdmin.includes(user.rol)) {
      tienePermiso = true;
    }
    else if (user.rol === Rol.TECNICO) {
      // TypeScript ya no marca error porque 'ticket' viene de checkTicketExpiration
      // y ticketDB ya fue validado como existente.
      tienePermiso = ticket.responsables.some((r: any) => r.id === user.id);
    }
    else if (user.rol === Rol.CLIENTE_INTERNO) {
      tienePermiso = ticket.creadorId === user.id;
    }

    if (!tienePermiso) {
      return res.status(403).json({ error: "No tienes permisos para ver el detalle de este ticket." });
    }

    return res.json(ticket);

  } catch (error) {
    await registrarError('GET_TICKET_DETAIL', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener el ticket" });
  }
};