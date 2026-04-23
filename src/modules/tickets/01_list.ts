import type { Request, Response } from "express";
import { EstadoTarea, Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { ticketStandardInclude } from "./types"; 
import type { TicketFilterQuery } from "./zod";
import { registrarError } from "../../utils/logger";
import { getTicketFilters } from "./helper";

export const listarTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    
    const { page, limit, sort, estado } = query;
    const offset = (page - 1) * limit;

    const querySinEstado = { ...query };
    delete querySinEstado.estado;
    const searchWhere = getTicketFilters({ id: user.id, rol: user.rol }, querySinEstado);

    const tableWhere: Prisma.TareaWhereInput = getTicketFilters({ id: user.id, rol: user.rol }, query);

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

    const ticketsDTO = tickets.map(t => {
      const historialMapeado = t.historial.map(h => {
        const notaString = h.nota || "";
        const esTiempoManual = notaString.includes('||[META:TIEMPO_MANUAL]||');
        return {
          ...h,
          esTiempoManual,
          nota: notaString.replace(' ||[META:TIEMPO_MANUAL]||', '')
        };
      });

      // Tarea cerrada/resuelta entregada después del día de vencimiento (calendario México)
      const isLate =
        ESTADOS_ENTREGADOS.includes(t.estado) &&
        !!t.finalizadoAt &&
        !!t.fechaVencimiento &&
        toMXDateStr(new Date(t.finalizadoAt)) > toMXDateStr(new Date(t.fechaVencimiento));

      // Tarea activa cuyo día de vencimiento ya pasó (calendario México)
      const isOverdue =
        ESTADOS_ACTIVOS_VENCIBLES.includes(t.estado) &&
        !!t.fechaVencimiento &&
        toMXDateStr(new Date(t.fechaVencimiento)) < hoyMX;

      return {
        ...t,
        historial: historialMapeado,
        isLate,
        isOverdue,
      };
    });

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