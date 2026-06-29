// list/list_mantenimientos.ts
// Listado de tareas de maquinaria: fuerza scope=mantenimientos (maquinaId NOT NULL).
import type { Request, Response } from "express";
import { EstadoTarea, Prisma } from "@prisma/client";
import { prisma } from "../../../db";
import { ticketStandardInclude } from "../types";
import type { TicketFilterQuery } from "../zod";
import { registrarError } from "../../../utils/logger";
import { getTicketFilters, computeTicketTemporalState } from "../helper";

export const listarMantenimientos = async (req: Request, res: Response) => {
  try {
    const user  = req.user!;
    // Forzar scope server-side — el frontend no necesita enviarlo
    const query: TicketFilterQuery = { ...req.query as unknown as TicketFilterQuery, scope: "mantenimientos" };

    const { page, limit, sort, estado } = query;
    const offset = (page - 1) * limit;

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const searchWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);
    const tableWhere:  Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);

    if (query.q) {
      const searchStr = query.q.trim();
      const searchFilter = {
        OR: [
          { titulo: { contains: searchStr } },
          { area:   { contains: searchStr } },
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

    if (!estado) {
      tableWhere.AND = [
        ...(Array.isArray(tableWhere.AND) ? tableWhere.AND : tableWhere.AND ? [tableWhere.AND] : []),
        { estado: { notIn: [EstadoTarea.CANCELADA] } },
      ];
    }

    const orderBy: Prisma.TareaOrderByWithRelationInput[] =
      sort && sort.length > 0
        ? sort.map((s) => s as Prisma.TareaOrderByWithRelationInput)
        : [{ createdAt: "desc" }];

    const [totalAbsoluto, totalPaginado, groupEstados, ticketsPage] = await Promise.all([
      prisma.tarea.count({ where: searchWhere }),
      prisma.tarea.count({ where: tableWhere }),
      prisma.tarea.groupBy({ by: ["estado"], _count: { id: true }, where: searchWhere }),
      prisma.tarea.findMany({ where: tableWhere, include: ticketStandardInclude, orderBy, skip: offset, take: limit }),
    ]);

    const resumenEstados = groupEstados.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    if (estado === EstadoTarea.CANCELADA || estado === EstadoTarea.RECHAZADO) {
      resumenEstados[estado] = totalPaginado;
    }

    const ticketsDTO = ticketsPage.map((t) => computeTicketTemporalState(t));

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenEstados,
      data: ticketsDTO,
    });
  } catch (error) {
    await registrarError("LIST_MANTENIMIENTOS", req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener mantenimientos" });
  }
};
