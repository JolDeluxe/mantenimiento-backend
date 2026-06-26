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

    // searchWhere: sin filtro de estado (para contar totales y resumen de estados)
    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const searchWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);

    // tableWhere: con todos los filtros aplicados (para la tabla paginada)
    const tableWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);

    // Búsqueda por texto libre / ID numérico
    if (query.q) {
      const searchStr = query.q.trim();
      const searchFilter = {
        OR: [
          { titulo: { contains: searchStr } },
          { area: { contains: searchStr } },
          ...(!isNaN(Number(searchStr)) ? [{ id: Number(searchStr) }] : []),
        ],
      };
      searchWhere.AND = [
        ...(Array.isArray(searchWhere.AND) ? searchWhere.AND : searchWhere.AND ? [searchWhere.AND] : []),
        searchFilter,
      ];
      tableWhere.AND = [
        ...(Array.isArray(tableWhere.AND) ? tableWhere.AND : tableWhere.AND ? [tableWhere.AND] : []),
        searchFilter,
      ];
    }

    // Sin filtro de estado explícito → excluir CANCELADAS por defecto
    if (!estado) {
      tableWhere.AND = [
        ...(Array.isArray(tableWhere.AND) ? tableWhere.AND : tableWhere.AND ? [tableWhere.AND] : []),
        { estado: { notIn: [EstadoTarea.CANCELADA] } },
      ];
    }

    // Ordenamiento declarativo: usa el sort enviado por el frontend.
    // Zod default → [{ createdAt: 'desc' }] = más reciente primero.
    // Prisma ordena en BD → paginación correcta en todos los casos.
    const orderBy: Prisma.TareaOrderByWithRelationInput[] =
      sort && sort.length > 0
        ? sort.map((s) => s as Prisma.TareaOrderByWithRelationInput)
        : [{ createdAt: "desc" }];

    const [totalAbsoluto, totalPaginado, groupEstados, ticketsPage] =
      await Promise.all([
        prisma.tarea.count({ where: searchWhere }),
        prisma.tarea.count({ where: tableWhere }),
        prisma.tarea.groupBy({
          by: ["estado"],
          _count: { id: true },
          where: searchWhere,
        }),
        prisma.tarea.findMany({
          where: tableWhere,
          include: ticketStandardInclude,
          orderBy,
          skip: offset,
          take: limit,
        }),
      ]);

    const resumenEstados = groupEstados.reduce(
      (acc, curr) => {
        acc[curr.estado] = curr._count.id;
        return acc;
      },
      {} as Record<string, number>
    );

    // Fix SummaryBar: inyectar total exacto cuando se filtra por estado terminal
    if (estado === EstadoTarea.CANCELADA || estado === EstadoTarea.RECHAZADO) {
      resumenEstados[estado] = totalPaginado;
    }

    const ticketsDTO = ticketsPage.map((t) => computeTicketTemporalState(t));

    return res.json({
      status: "success",
      pagination: {
        total: totalPaginado,
        page,
        limit,
        totalPages: Math.ceil(totalPaginado / limit),
      },
      totalAbsoluto,
      resumenEstados,
      data: ticketsDTO,
    });
  } catch (error) {
    await registrarError("LIST_TICKETS", req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};