import type { Request, Response } from "express";
import { prisma } from "../../db";
import { 
  Rol, 
  Prisma, 
  Prioridad, 
  EstadoTarea, 
  TipoTarea, 
  ClasificacionTarea 
} from "@prisma/client";
import { ticketStandardInclude } from "./types"; 
import { ticketFilterSchema } from "./zod";
import { registrarError } from "../../utils/logger";

export const listarTickets = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const validation = ticketFilterSchema.safeParse(req.query);
    if (!validation.success) {
        return res.status(400).json({ error: "Filtros inválidos", details: validation.error.issues });
    }
    const { 
        q, page, limit, 
        estado, prioridad, tipo, clasificacion, responsableId,
        fechaInicio, fechaFin 
    } = validation.data;

    const offset = (page - 1) * limit;

    let baseWhere: Prisma.TareaWhereInput = {};

    switch (user.rol) {
      case Rol.TECNICO:
        baseWhere.responsables = { some: { id: user.id } };
        break;
      case Rol.CLIENTE_INTERNO:
        baseWhere.creadorId = user.id;
        break;
    }

    if (prioridad) baseWhere.prioridad = prioridad as Prioridad;
    if (estado) baseWhere.estado = estado as EstadoTarea;
    if (tipo) baseWhere.tipo = tipo as TipoTarea;
    if (clasificacion) baseWhere.clasificacion = clasificacion as ClasificacionTarea;

    if (responsableId) {
        baseWhere.responsables = {
            some: { id: responsableId }
        };
    }

    if (fechaInicio || fechaFin) {
      baseWhere.createdAt = {};
      if (fechaInicio) baseWhere.createdAt.gte = new Date(fechaInicio);
      if (fechaFin) {
        const endDay = new Date(fechaFin);
        endDay.setHours(23, 59, 59, 999);
        baseWhere.createdAt.lte = endDay;
      }
    }

    if (q) {
      const isNumber = !isNaN(Number(q));
      baseWhere.AND = [{
        OR: [
          { titulo: { contains: q } },
          { descripcion: { contains: q } },
          { planta: { contains: q } },
          { area: { contains: q } },
          { creador: { nombre: { contains: q } } },
          ...(isNumber ? [{ id: Number(q) }] : [])
        ]
      }];
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay()); 
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
        tickets, 
        total, 
        conteoPorEstado,
        conteoPorTipo, 
        countMonth,
        countWeek,
        countDay,
        cargaTecnicos
    ] = await Promise.all([
      // 1. Lista paginada
      prisma.tarea.findMany({
        where: baseWhere,
        take: limit,
        skip: offset,
        include: ticketStandardInclude,
        orderBy: { createdAt: 'desc' }
      }),
      // 2. Total global (con filtros aplicados)
      prisma.tarea.count({ where: baseWhere }),
      // 3. Agrupación por Estado
      prisma.tarea.groupBy({
        by: ['estado'],
        where: baseWhere,
        _count: { estado: true }
      }),
      // 4. NUEVO: Agrupación por TIPO (Ticket, Planeada, Extraordinaria)
      prisma.tarea.groupBy({
        by: ['tipo'],
        where: baseWhere,
        _count: { tipo: true }
      }),
      // 5, 6, 7. Contadores de tiempo (Mes, Semana, Día)
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfMonth } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfWeek } } }),
      prisma.tarea.count({ where: { ...baseWhere, createdAt: { gte: startOfDay } } }),
      
      // 8. Carga de trabajo (Solo Admins)
      (user.rol === Rol.SUPER_ADMIN || user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO)
        ? prisma.usuario.findMany({
            where: { rol: Rol.TECNICO, estado: "ACTIVO" },
            select: {
                id: true,
                nombre: true,
                _count: {
                    select: { tareasAsignadas: { where: baseWhere } }
                }
            }
        })
        : Promise.resolve([]) 
    ]);

    // Procesar conteo por Estado
    const resumenEstatus = conteoPorEstado.reduce((acc, curr) => {
      acc[curr.estado] = curr._count.estado;
      return acc;
    }, {} as Record<string, number>);

    // NUEVO: Procesar conteo por Tipo
    const resumenTipo = conteoPorTipo.reduce((acc, curr) => {
      acc[curr.tipo] = curr._count.tipo;
      return acc;
    }, {} as Record<string, number>);

    res.json({
      status: "success",
      metrics: {
        totalGlobal: total,
        byStatus: resumenEstatus,
        byType: resumenTipo,
        period: {
            mes: countMonth,
            semana: countWeek,
            hoy: countDay
        },
        workload: cargaTecnicos.map(t => ({
            id: t.id,
            nombre: t.nombre,
            cantidad: t._count.tareasAsignadas
        }))
      },
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data: tickets
    });

  } catch (error) {
    await registrarError('LIST_TICKETS', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno al obtener tickets" });
  }
};