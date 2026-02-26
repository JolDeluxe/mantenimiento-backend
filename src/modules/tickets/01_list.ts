import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { ticketStandardInclude } from "./types"; 
import type { TicketFilterQuery } from "./zod";
import { registrarError } from "../../utils/logger";
import { getTicketFilters, isAdminOrJefe } from "./helper";

export const listarTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const query = req.query as unknown as TicketFilterQuery;
    
    const { page, limit, sort } = query;
    const offset = (page - 1) * limit;

    const baseWhere = getTicketFilters({ id: user.id, rol: user.rol }, query);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); 
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [ tickets, total, conteoPorEstado, conteoPorTipo, countMonth, countWeek, countDay, cargaTecnicos ] = await Promise.all([
      prisma.tarea.findMany({
        where: baseWhere,
        take: limit,
        skip: offset,
        include: ticketStandardInclude,
        orderBy: sort 
      }),
      prisma.tarea.count({ where: baseWhere }),
      prisma.tarea.groupBy({ by: ['estado'], where: baseWhere, _count: { estado: true } }),
      prisma.tarea.groupBy({ by: ['tipo'], where: baseWhere, _count: { tipo: true } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfMonth } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfWeek } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfDay } } }),
      isAdminOrJefe(user.rol)
        ? prisma.usuario.findMany({
            where: { rol: Rol.TECNICO, estado: "ACTIVO" },
            select: { id: true, nombre: true, _count: { select: { tareasAsignadas: { where: baseWhere } } } }
          })
        : Promise.resolve([]) 
    ]);

    const resumenEstatus = conteoPorEstado.reduce((acc, curr) => ({ ...acc, [curr.estado]: curr._count.estado }), {});
    const resumenTipo = conteoPorTipo.reduce((acc, curr) => ({ ...acc, [curr.tipo]: curr._count.tipo }), {});

    return res.json({
      status: "success",
      metrics: {
        totalGlobal: total,
        byStatus: resumenEstatus,
        byType: resumenTipo,
        period: { mes: countMonth, semana: countWeek, hoy: countDay },
        workload: cargaTecnicos.map((t: any) => ({
          id: t.id,
          nombre: t.nombre,
          cantidad: t._count.tareasAsignadas
        }))
      },
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: tickets
    });

  } catch (error) {
    await registrarError('LIST_TICKETS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};