import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol } from "@prisma/client";
import { registrarError } from "../../utils/logger";

export const getBitacora = async (req: Request, res: Response) => {
  try {
    // Seguridad: Solo SUPER_ADMIN puede ver la bitácora completa
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "Acceso denegado. Solo administradores." });
    }

    const { page, limit, tipo, usuarioId } = req.query;

    // Paginación
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 100);
    const offset = (pageNum - 1) * limitNum;

    // Construcción del filtro (Where)
    const whereClause: any = {};

    // Filtro: Tipo de Log
    if (tipo === 'errores') {
      // Busca acciones que empiecen con "ERROR" o contengan "FALLIDO"
      whereClause.OR = [
        { accion: { startsWith: 'ERROR' } },
        { accion: { contains: 'FALLIDO' } },
        { accion: { contains: 'FAIL' } }
      ];
    } else if (tipo === 'acciones') {
      // Excluye los errores
      whereClause.AND = [
        { accion: { not: { startsWith: 'ERROR' } } },
        { accion: { not: { contains: 'FALLIDO' } } }
      ];
    }

    // Filtro: Por Usuario específico
    if (usuarioId) {
      const uId = Number(usuarioId);
      if (!isNaN(uId)) {
        whereClause.usuarioId = uId;
      }
    }

    // 3. Consulta a BD (Transacción para contar y traer datos al mismo tiempo)
    const [total, logs] = await prisma.$transaction([
      prisma.bitacora.count({ where: whereClause }),
      prisma.bitacora.findMany({
        where: whereClause,
        take: limitNum,
        skip: offset,
        orderBy: { createdAt: 'desc' }, // Lo más reciente primero
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

    // 4. Respuesta
    return res.json({
      status: "success",
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      data: logs
    });

  } catch (error) {
    // Si falla el lector de logs, registramos el error
    await registrarError('LEER_BITACORA', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener la bitácora" });
  }
};