// list/list_bandeja.ts
// Listado universal sin restricción de scope. Sirve a features/bandeja-general.
import type { Request, Response } from "express";
import { EstadoTarea, Prisma } from "@prisma/client";
import { prisma } from "../../../db";
import { ticketStandardInclude } from "../types";
import type { TicketFilterQuery } from "../zod";
import { registrarError } from "../../../utils/logger";
import { getTicketFilters, withSearchFilter, computeTicketTemporalState, calcularMetricasDashboard, ordenarTicketsOperativamente } from "../helper";

export const listarBandeja = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;

    const { page, limit, sort, estado } = query;
    const offset = (page - 1) * limit;
    const usaOrdenOperativo = !estado || query.venceManana === true;

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const searchWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);
    const tableWhere: Prisma.TareaWhereInput  = getTicketFilters({ id: user.id, rol: user.rol }, query);

    const searchWhereFinal = withSearchFilter(searchWhere, query.q);
    const tableWhereFinal = withSearchFilter(tableWhere, query.q);

    if (!estado) {
      tableWhereFinal.AND = [
        ...(Array.isArray(tableWhereFinal.AND) ? tableWhereFinal.AND : tableWhereFinal.AND ? [tableWhereFinal.AND] : []),
        { estado: { notIn: [EstadoTarea.CANCELADA] } },
      ];
    }

    const orderBy: Prisma.TareaOrderByWithRelationInput[] =
      sort && sort.length > 0
        ? sort.map((s) => s as Prisma.TareaOrderByWithRelationInput)
        : [{ createdAt: "desc" }];

    const [totalAbsoluto, totalPaginado, groupEstados, ticketsPage] = await Promise.all([
      prisma.tarea.count({ where: searchWhereFinal }),
      prisma.tarea.count({ where: tableWhereFinal }),
      prisma.tarea.groupBy({ by: ["estado"], _count: { id: true }, where: searchWhereFinal }),
      usaOrdenOperativo
        ? prisma.tarea.findMany({ where: tableWhereFinal, include: ticketStandardInclude })
        : prisma.tarea.findMany({ where: tableWhereFinal, include: ticketStandardInclude, orderBy, skip: offset, take: limit }),
    ]);

    const resumenEstados = groupEstados.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    if (estado === EstadoTarea.CANCELADA || estado === EstadoTarea.RECHAZADO) {
      resumenEstados[estado] = totalPaginado;
    }

    const metricas = await calcularMetricasDashboard(
      { id: user.id, rol: user.rol },
      querySinEstado,
      totalPaginado
    );

    const ticketsDTO = ticketsPage.map((t) => computeTicketTemporalState(t));
    const data = usaOrdenOperativo
      ? ordenarTicketsOperativamente(ticketsDTO).slice(offset, offset + limit)
      : ticketsDTO;

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenEstados,
      metricas,
      data,
    });
  } catch (error) {
    await registrarError("LIST_BANDEJA", req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};
