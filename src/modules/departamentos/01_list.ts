import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../../db";
import { env } from "../../env";
import { Rol, Estatus } from "@prisma/client";
import { registrarError } from "../../utils/logger"; // <--- IMPORTADO

// LISTAR DEPARTAMENTOS
export const listDepartamentos = async (req: Request, res: Response) => {
  try {
    let esSuperAdmin = false;

    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      if (token) {
        try {
          const decoded: any = jwt.verify(token, env.JWT_SECRET as string);
          if (decoded && decoded.rol === Rol.SUPER_ADMIN) {
             esSuperAdmin = true;
          }
        } catch (error) {
            // Token inválido, ignoramos y tratamos como público/usuario normal
        }
      }
    }

    //  Definir filtros
    const whereClause: any = {};

    if (!esSuperAdmin) {
        whereClause.nombre = { not: "Mantenimiento" }; // Ocultar Mantenimiento
        whereClause.estado = Estatus.ACTIVO;           // Solo activos
    }

    // Consultar BD
    const departamentos = await prisma.departamento.findMany({
      where: whereClause,
      orderBy: { nombre: "asc" },
      include: {
        _count: {
          select: { usuarios: true }
        }
      }
    });

    return res.json(departamentos);

  } catch (error) {
    // LOG DE ERROR (Sin usuario ID porque puede ser público o fallar el token)
    await registrarError('LIST_DEPARTAMENTOS', null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// --- LISTAR INACTIVOS (Solo Admin) ---
export const listDepartamentosInactivos = async (req: Request, res: Response) => {
  try {
    // Verificación de seguridad (Solo Super Admin)
    if (req.user?.rol !== Rol.SUPER_ADMIN) {
      return res.status(403).json({ error: "No autorizado. Solo SUPER_ADMIN puede ver papelería de reciclaje." });
    }

    // Consultar BD
    const departamentosInactivos = await prisma.departamento.findMany({
      where: {
        estado: Estatus.INACTIVO
      },
      orderBy: { nombre: "asc" },
      include: {
        _count: {
          select: { usuarios: true }
        }
      }
    });

    return res.json(departamentosInactivos);

  } catch (error) {
    // LOG DE ERROR
    await registrarError('LIST_DEPTOS_INACTIVOS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};

// --- OBTENER POR ID ---
export const getDepartamentoById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const departamentoId = Number(id);

    if (isNaN(departamentoId)) {
      return res.status(400).json({ error: "ID de departamento inválido" });
    }

    const departamento = await prisma.departamento.findUnique({
      where: { id: departamentoId },
      include: {
        _count: {
          select: { usuarios: true }
        }
      }
    });

    if (!departamento) {
      return res.status(404).json({ error: "Departamento no encontrado" });
    }

    return res.json(departamento);

  } catch (error) {
    // LOG DE ERROR
    await registrarError('GET_DEPARTAMENTO_ID', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};