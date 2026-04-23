import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import { ticketStandardInclude } from "./types"; 
import { checkTicketExpiration } from "./expiration";
import type { GetTicketByIdParams } from "./zod";

export const getTicket = async (req: Request, res: Response) => {
  try {
    const user = req.user!; 
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
    
    // Delegación de regla de dominio pura
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

    // --- INICIO LÓGICA DE TIEMPOS ESTRICTA (FAT BACKEND) ---
    const toMXDateStr = (d: Date): string =>
      d.toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const hoyMX = toMXDateStr(new Date());

    const ESTADOS_ENTREGADOS: EstadoTarea[] = [EstadoTarea.RESUELTO, EstadoTarea.CERRADO];
    const ESTADOS_ACTIVOS_VENCIBLES: EstadoTarea[] = [
      EstadoTarea.PENDIENTE,
      EstadoTarea.ASIGNADA,
      EstadoTarea.EN_PROGRESO,
      EstadoTarea.EN_PAUSA,
      EstadoTarea.RECHAZADO,
    ];

    const isLate =
      ESTADOS_ENTREGADOS.includes(ticket.estado) &&
      !!ticket.finalizadoAt &&
      !!ticket.fechaVencimiento &&
      toMXDateStr(new Date(ticket.finalizadoAt)) > toMXDateStr(new Date(ticket.fechaVencimiento));

    const isOverdue =
      ESTADOS_ACTIVOS_VENCIBLES.includes(ticket.estado) &&
      !!ticket.fechaVencimiento &&
      toMXDateStr(new Date(ticket.fechaVencimiento)) < hoyMX;
    // --- FIN LÓGICA DE TIEMPOS ---

    // Patrón DTO: Intercepción y limpieza antes de serializar
    const historialMapeado = ticket.historial.map(h => {
      const notaString = h.nota || "";
      const esTiempoManual = notaString.includes('||[META:TIEMPO_MANUAL]||');
      return {
        ...h,
        esTiempoManual,
        nota: notaString.replace(' ||[META:TIEMPO_MANUAL]||', '')
      };
    });

    const ticketDTO = {
      ...ticket,
      historial: historialMapeado,
      isLate,
      isOverdue
    };

    return res.json(ticketDTO);

  } catch (error) {
    await registrarError('GET_TICKET_DETAIL', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener el ticket" });
  }
};