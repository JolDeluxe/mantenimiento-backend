import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { ListBitacoraQuery } from "./zod";

export const getBitacora = async (req: Request, res: Response) => {
  try {
    // Seguridad: Solo SUPER_ADMIN puede ver la bitácora completa
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "Acceso denegado. Solo administradores." });
    }

    // Extraemos los datos ya limpios y validados por Zod
    const { page, limit, tipo, usuarioId, sort } = req.query as unknown as ListBitacoraQuery;
    const offset = (page - 1) * limit;

    // Construcción del filtro con tipos estrictos de Prisma
    const whereClause: Prisma.BitacoraWhereInput = {};

    if (tipo === 'errores') {
      whereClause.OR = [
        { accion: { startsWith: 'ERROR' } },
        { accion: { contains: 'FALLIDO' } },
        { accion: { contains: 'FAIL' } }
      ];
    } else if (tipo === 'acciones') {
      whereClause.AND = [
        { accion: { not: { startsWith: 'ERROR' } } },
        { accion: { not: { contains: 'FALLIDO' } } }
      ];
    }

    if (usuarioId) {
      whereClause.usuarioId = usuarioId;
    }

    const [total, logs] = await prisma.$transaction([
      prisma.bitacora.count({ where: whereClause }),
      prisma.bitacora.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        orderBy: sort, // Ordenamiento dinámico inyectado
        include: {
          usuario: {
            select: {
              id: true,
              username: true,
              email: true,
              rol: true,
              imagen: true
            }
          }
        }
      })
    ]);

    return res.json({
      status: "success",
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      },
      data: logs
    });

  } catch (error) {
    await registrarError('LEER_BITACORA', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener la bitácora" });
  }
};