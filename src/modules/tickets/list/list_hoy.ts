// list/list_hoy.ts
// Listado del día. Fuerza perteneceAHoy=true.
// Ordenamiento híbrido:
//   1. RECHAZADOS (siempre arriba)
//   2. AGENDA — Tareas con horaInicioProgramada, orden cronológico ASC
//   3. COLA    — Sin hora: primero atrasadas, luego por prioridad DESC, luego createdAt DESC
import type { Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../db";
import { ticketStandardInclude } from "../types";
import type { TicketFilterQuery } from "../zod";
import { registrarError } from "../../../utils/logger";
import { getTicketFilters, computeTicketTemporalState } from "../helper";

const PRIORITY_WEIGHT: Record<string, number> = {
  CRITICA: 4,
  ALTA:    3,
  MEDIA:   2,
  BAJA:    1,
};

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

    // HOY: sin filtro de estado extra — getTicketFilters ya excluye terminales cuando perteneceAHoy=true
    const [totalAbsoluto, totalPaginado, groupEstados, ticketsPage] = await Promise.all([
      prisma.tarea.count({ where: searchWhere }),
      prisma.tarea.count({ where: tableWhere }),
      prisma.tarea.groupBy({ by: ["estado"], _count: { id: true }, where: searchWhere }),
      // Sin paginación por offset aquí — el sort híbrido ocurre en memoria (volumen acotado a 1 día)
      prisma.tarea.findMany({ where: tableWhere, include: ticketStandardInclude }),
    ]);

    const resumenEstados = groupEstados.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    if (estado === "CANCELADA" || estado === "RECHAZADO") {
      resumenEstados[estado] = totalPaginado;
    }

    // --- SORT HÍBRIDO EN MEMORIA ---
    const ticketsDTO = ticketsPage.map((t) => computeTicketTemporalState(t));

    ticketsDTO.sort((a, b) => {
      // 1. RECHAZADOS primero
      const aR = a.estado === "RECHAZADO";
      const bR = b.estado === "RECHAZADO";
      if (aR && !bR) return -1;
      if (!aR && bR) return  1;

      // 2. AGENDA vs COLA
      const aHasTime = !!a.horaInicioProgramada;
      const bHasTime = !!b.horaInicioProgramada;
      if (aHasTime && !bHasTime) return -1;
      if (!aHasTime && bHasTime) return  1;

      if (aHasTime && bHasTime) {
        return new Date(a.horaInicioProgramada!).getTime() - new Date(b.horaInicioProgramada!).getTime();
      }

      // 3. COLA: atrasadas primero
      const aOverdue = a.isOverdue === true;
      const bOverdue = b.isOverdue === true;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return  1;

      // 4. COLA: prioridad DESC
      const aW = PRIORITY_WEIGHT[a.prioridad] || 0;
      const bW = PRIORITY_WEIGHT[b.prioridad] || 0;
      if (aW !== bW) return bW - aW;

      // 5. Creación DESC
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Paginación manual post-sort
    const paginated = ticketsDTO.slice(offset, offset + limit);

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenEstados,
      data: paginated,
    });
  } catch (error) {
    await registrarError("LIST_HOY", req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets de hoy" });
  }
};
