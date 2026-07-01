// list/list_hoy.ts
// Listado del día. Fuerza perteneceAHoy=true.
// Ordenamiento operativo por scope:
//   TODAS: rechazadas -> atrasadas -> reportes -> correctivos -> criticidad -> prioridad/hora -> tipo -> creación.
// Actividades usa una variante propia: rechazadas -> atrasadas -> prioridad/hora -> tipo -> creación.
// Mantenimientos usa una variante propia: rechazadas -> atrasadas -> reportes/correctivos -> criticidad -> prioridad/hora.
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../db";
import { ticketStandardInclude } from "../types";
import type { TicketFilterQuery } from "../zod";
import { registrarError } from "../../../utils/logger";
import {
  getTicketFilters,
  withSearchFilter,
  computeTicketTemporalState,
  calcularMetricasDashboard,
  ordenarTodasHoyOperativamente,
  ordenarActividadesHoyOperativamente,
  ordenarMantenimientosHoyOperativamente,
} from "../helper";

export const listarHoy = async (req: Request, res: Response) => {
  try {
    const user  = req.user!;
    const query = { ...req.query as unknown as TicketFilterQuery, perteneceAHoy: true as const };

    const { page, limit, estado } = query;
    const offset = (page - 1) * limit;

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const searchWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);
    const tableWhere:  Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);

    const searchWhereFinal = withSearchFilter(searchWhere, query.q);
    const tableWhereFinal = withSearchFilter(tableWhere, query.q);

    // HOY: sin filtro de estado extra — getTicketFilters ya excluye terminales cuando perteneceAHoy=true
    const [totalAbsoluto, totalPaginado, groupEstados, ticketsPage] = await Promise.all([
      prisma.tarea.count({ where: searchWhereFinal }),
      prisma.tarea.count({ where: tableWhereFinal }),
      prisma.tarea.groupBy({ by: ["estado"], _count: { id: true }, where: searchWhereFinal }),
      // Sin paginación por offset aquí — el sort híbrido ocurre en memoria (volumen acotado a 1 día)
      prisma.tarea.findMany({ where: tableWhereFinal, include: ticketStandardInclude }),
    ]);

    const resumenEstados = groupEstados.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    if (estado === "CANCELADA" || estado === "RECHAZADO") {
      resumenEstados[estado] = totalPaginado;
    }

    const metricas = await calcularMetricasDashboard(
      { id: user.id, rol: user.rol },
      querySinEstado,
      totalPaginado
    );

    const ticketsDTO = ticketsPage.map((t) => computeTicketTemporalState(t));
    const ticketsOrdenados = query.scope === "actividades"
      ? ordenarActividadesHoyOperativamente(ticketsDTO)
      : query.scope === "mantenimientos"
        ? ordenarMantenimientosHoyOperativamente(ticketsDTO)
        : ordenarTodasHoyOperativamente(ticketsDTO);

    // Paginación manual post-sort
    const paginated = ticketsOrdenados.slice(offset, offset + limit);

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenEstados,
      metricas,
      data: paginated,
    });
  } catch (error) {
    await registrarError("LIST_HOY", req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets de hoy" });
  }
};
