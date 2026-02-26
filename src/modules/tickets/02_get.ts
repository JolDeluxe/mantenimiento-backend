import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { ticketStandardInclude } from "./types"; 
import { checkTicketExpiration } from "./expiration";
// Importamos directamente el tipo inferido desde Zod
import type { GetTicketByIdParams } from "./zod";

export const getTicket = async (req: Request, res: Response) => {
  try {
    const user = req.user!; 
    // Usamos el tipo limpio exportado
    const { id: ticketId } = req.params as unknown as GetTicketByIdParams;

    const ticketDB = await prisma.tarea.findUnique({
      where: { id: ticketId },
      include: ticketStandardInclude
    });

    if (!ticketDB) {
      return res.status(404).json({ error: "Ticket no encontrado" });
    }

    const protocol = req.protocol;
    const host = req.get('host');
    const fullUrlHost = `${protocol}://${host}`;
    
    const ticket = await checkTicketExpiration(ticketDB, fullUrlHost);

    let tienePermiso = false;
    const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
    
    if (rolesAdmin.includes(user.rol)) {
      tienePermiso = true;
    } else if (user.rol === Rol.TECNICO) {
      tienePermiso = ticket.responsables.some((r: any) => r.id === user.id);
    } else if (user.rol === Rol.CLIENTE_INTERNO) {
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