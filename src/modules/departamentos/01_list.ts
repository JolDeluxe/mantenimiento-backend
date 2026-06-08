import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";
import type { ListDepartamentosQuery, GetDepartamentoByIdParams } from "./zod";
import jwt from "jsonwebtoken";
import { env } from "../../env";
import type { TokenPayload } from "../auth/types";

export const listDepartamentos = async (req: Request, res: Response) => {
  try {
    let esSuperAdmin = req.user?.rol === Rol.SUPER_ADMIN;

    if (!esSuperAdmin) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith("Bearer ")) {
        const token = authHeader.split(" ")[1];
        if (token) {
          try {
            const decoded = jwt.verify(token, env.JWT_SECRET as string) as unknown as TokenPayload;
            const usuario = await prisma.usuario.findUnique({
              where: { id: decoded.id },
              select: { rol: true }
            });
            if (usuario && usuario.rol === Rol.SUPER_ADMIN) {
              esSuperAdmin = true;
            }
          } catch {
            // Ignorar token inválido/expirado
          }
        }
      }
    }
    const { q, page, limit, sortBy, sortOrder } = req.query as unknown as ListDepartamentosQuery;
    
    const offset = (page - 1) * limit;
    const whereClause: Prisma.DepartamentoWhereInput = {};

    if (!esSuperAdmin) {
      whereClause.nombre = { not: "Mantenimiento" };
      whereClause.estado = Estatus.ACTIVO;
    }

    if (q) {
      whereClause.OR = [
        { nombre: { contains: q } },
        { planta: { contains: q } }
      ];
    }

    const [total, departamentos] = await prisma.$transaction([
      prisma.departamento.count({ where: whereClause }),
      prisma.departamento.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        orderBy: { [sortBy]: sortOrder },
        include: { _count: { select: { usuarios: true } } }
      })
    ]);

    return res.json({
      status: "success",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: departamentos
    });

  } catch (error) {
    await registrarError('LIST_DEPARTAMENTOS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno al obtener departamentos" });
  }
};

export const listDepartamentosInactivos = async (req: Request, res: Response) => {
  try {
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado." });
    }

    const { q, page, limit, sortBy, sortOrder } = req.query as unknown as ListDepartamentosQuery;
    const offset = (page - 1) * limit;

    const whereClause: Prisma.DepartamentoWhereInput = { estado: Estatus.INACTIVO };

    if (q) {
      whereClause.nombre = { contains: q };
    }

    const [total, departamentos] = await prisma.$transaction([
      prisma.departamento.count({ where: whereClause }),
      prisma.departamento.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        orderBy: { [sortBy]: sortOrder },
        include: { _count: { select: { usuarios: true } } }
      })
    ]);

    return res.json({
      status: "success",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: departamentos
    });

  } catch (error) {
    await registrarError('LIST_DEPTOS_INACTIVOS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

export const getDepartamentoById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as unknown as GetDepartamentoByIdParams;

    const departamento = await prisma.departamento.findUnique({
      where: { id },
      include: { _count: { select: { usuarios: true } } }
    });

    if (!departamento) return res.status(404).json({ error: "No encontrado" });

    return res.json(departamento);
  } catch (error) {
    await registrarError('GET_DEPARTAMENTO_ID', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno" });
  }
};