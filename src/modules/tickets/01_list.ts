import type { Request, Response } from "express";
import { EstadoTarea, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { ticketStandardInclude } from "./types"; 
import type { TicketFilterQuery } from "./zod";
import { registrarError } from "../../utils/logger";
import { getTicketFilters, computeTicketTemporalState } from "./helper";

export const listarTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    
    const { page, limit, sort, estado } = query;
    const offset = (page - 1) * limit;

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    
    const searchWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);
    const tableWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);

    // Inyección estricta de búsqueda por texto / id en el cerebro del Backend
    if (query.q) {
      const searchStr = query.q.trim();
      const searchFilter = {
        OR: [
          { titulo: { contains: searchStr } },
          { area: { contains: searchStr } },
          ...( !isNaN(Number(searchStr)) ? [{ id: Number(searchStr) }] : [] )
        ]
      };

      searchWhere.AND = [
        ...(Array.isArray(searchWhere.AND) ? searchWhere.AND : (searchWhere.AND ? [searchWhere.AND] : [])),
        searchFilter
      ];
      
      tableWhere.AND = [
        ...(Array.isArray(tableWhere.AND) ? tableWhere.AND : (tableWhere.AND ? [tableWhere.AND] : [])),
        searchFilter
      ];
    }

    if (!estado) {
      tableWhere.AND = [
        ...(Array.isArray(tableWhere.AND) ? tableWhere.AND : (tableWhere.AND ? [tableWhere.AND] : [])),
        { estado: { notIn: [EstadoTarea.CANCELADA] } } 
      ];
    }

    const [ totalAbsoluto, groupEstados, totalPaginado, tickets ] = await Promise.all([
      prisma.tarea.count({ where: searchWhere }),
      prisma.tarea.groupBy({
        by: ["estado"],
        _count: { id: true },
        where: searchWhere 
      }),
      prisma.tarea.count({ where: tableWhere }),
      prisma.tarea.findMany({
        where: tableWhere,
        take: limit,
        skip: offset,
        include: ticketStandardInclude,
        orderBy: sort 
      })
    ]);

    const resumenEstados = groupEstados.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    // Resuelve el Bug del SummaryBar en 0 inyectando el total exacto paginado
    if (estado === EstadoTarea.CANCELADA || estado === EstadoTarea.RECHAZADO) {
      resumenEstados[estado] = totalPaginado;
    }

    const ticketsDTO = tickets.map(t => computeTicketTemporalState(t));

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenEstados,
      data: ticketsDTO
    });

  } catch (error) {
    await registrarError('LIST_TICKETS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};