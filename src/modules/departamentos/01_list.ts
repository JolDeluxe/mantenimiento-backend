import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, Estatus } from "@prisma/client";
import { registrarError } from "../../utils/logger";

// --- LISTAR DEPARTAMENTOS ACTIVOS ---
export const listDepartamentos = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user; 
    const esSuperAdmin = usuarioSolicitante?.rol === Rol.SUPER_ADMIN;

    const { q, page, limit } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    const whereClause: any = {};

    // Regla de Negocio: Ocultar Mantenimiento a no-admins
    if (!esSuperAdmin) {
      whereClause.nombre = { not: "Mantenimiento" };
      whereClause.estado = Estatus.ACTIVO;
    }

    if (q && typeof q === 'string') {
      whereClause.OR = [
        { nombre: { contains: q } },
        { planta: { contains: q } }
      ];
    }

    // Usamos el patrón de transacción que ya usas en Usuarios
    const [total, departamentos] = await prisma.$transaction([
      prisma.departamento.count({ where: whereClause }),
      prisma.departamento.findMany({
        where: whereClause,
        take: limitNum,
        skip: offset,
        orderBy: { nombre: "asc" },
        include: {
          _count: { select: { usuarios: true } }
        }
      })
    ]);

    res.json({
      status: "success",
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      data: departamentos
    });

  } catch (error) {
    await registrarError('LIST_DEPARTAMENTOS', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno al obtener departamentos" });
  }
};

// --- LISTAR INACTIVOS (Solo Admin) ---
export const listDepartamentosInactivos = async (req: Request, res: Response) => {
  try {
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado." });
    }

    const { q, page, limit } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    const whereClause: any = { estado: Estatus.INACTIVO };

    if (q && typeof q === 'string') {
      whereClause.nombre = { contains: q };
    }

    const [total, departamentos] = await prisma.$transaction([
      prisma.departamento.count({ where: whereClause }),
      prisma.departamento.findMany({
        where: whereClause,
        take: limitNum,
        skip: offset,
        orderBy: { nombre: "asc" },
        include: {
          _count: { select: { usuarios: true } }
        }
      })
    ]);

    res.json({
      status: "success",
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      },
      data: departamentos
    });

  } catch (error) {
    await registrarError('LIST_DEPTOS_INACTIVOS', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// getDepartamentoById se mantiene igual devolviendo el objeto único
export const getDepartamentoById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const departamentoId = Number(id);

    if (isNaN(departamentoId)) return res.status(400).json({ error: "ID inválido" });

    const departamento = await prisma.departamento.findUnique({
      where: { id: departamentoId },
      include: { _count: { select: { usuarios: true } } }
    });

    if (!departamento) return res.status(404).json({ error: "No encontrado" });

    res.json(departamento);
  } catch (error) {
    await registrarError('GET_DEPARTAMENTO_ID', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno" });
  }
};