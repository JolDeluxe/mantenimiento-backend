import type { Request, Response } from "express";
import { prisma } from "../../db";
import { ticketStandardInclude } from "./types"; 
import type { TicketFilterQuery } from "./zod";
import { registrarError } from "../../utils/logger";
import { getTicketFilters } from "./helper";

export const listarTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    
    const { page, limit, sort } = query;
    const offset = (page - 1) * limit;

    const baseWhere = getTicketFilters({ id: user.id, rol: user.rol }, query);

    const [ tickets, total ] = await Promise.all([
      prisma.tarea.findMany({
        where: baseWhere,
        take: limit,
        skip: offset,
        include: ticketStandardInclude,
        orderBy: sort 
      }),
      prisma.tarea.count({ where: baseWhere })
    ]);

    return res.json({
      status: "success",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: tickets
    });

  } catch (error) {
    await registrarError('LIST_TICKETS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};