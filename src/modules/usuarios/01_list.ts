import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Estatus, Rol, Prisma } from "@prisma/client";
import { getSecurityFilters } from "./helper"; 
import { registrarError } from "../../utils/logger";
import type { ListUsuariosQuery, GetUsuarioByIdParams } from "./zod";

export const listarUsuarios = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    
    // CORRECCIÓN 1: Extraemos 'sort' en lugar de sortBy y sortOrder
    const { q, page, limit, rol, sort } = req.query as unknown as ListUsuariosQuery;

    const offset = (page - 1) * limit;
    let whereClause: Prisma.UsuarioWhereInput = { estado: Estatus.ACTIVO };

    try {
      const securityFilter = getSecurityFilters(usuarioSolicitante);
      if (securityFilter === null) return res.status(403).json({ error: "Acceso denegado." });
      whereClause = { ...whereClause, ...securityFilter };
    } catch (e) {
      return res.status(400).json({ error: "Error de configuración de usuario." });
    }

    if (rol) {
      if (whereClause.rol && whereClause.rol !== rol) {
         return res.json({ 
             status: "success",
             pagination: { total: 0, page, limit, totalPages: 0 },
             data: [] 
         });
      }
      whereClause.rol = rol as Rol;
    }

    if (q) {
      whereClause.AND = [{
          OR: [
            { nombre: { contains: q } },
            { username: { contains: q } } 
          ]
      }];
    }

    const [total, usuarios] = await prisma.$transaction([
      prisma.usuario.count({ where: whereClause }),
      prisma.usuario.findMany({
        where: whereClause,
        take: limit,
        skip: offset,
        select: {
          id: true, nombre: true, username: true, imagen: true, 
          email: true, rol: true, cargo: true, estado: true, telefono: true,
          departamento: { select: { nombre: true, planta: true, tipo: true } },
        },
        // CORRECCIÓN 2: Le pasamos el arreglo completo a Prisma
        orderBy: sort 
      })
    ]);
    
    return res.json({ 
      status: "success",
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      data: usuarios 
    });

  } catch (error) {
    await registrarError('LIST_USUARIOS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error al obtener usuarios" });
  }
};

export const listarInactivos = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    
    // CORRECCIÓN 3: Extraemos 'sort'
    const { q, page, limit, sort } = req.query as unknown as ListUsuariosQuery;
    
    const offset = (page - 1) * limit;
    let whereClause: Prisma.UsuarioWhereInput = { estado: Estatus.INACTIVO };

    if (usuarioSolicitante.rol !== Rol.SUPER_ADMIN && usuarioSolicitante.rol !== Rol.JEFE_MTTO) {
        return res.status(403).json({ error: "Acceso denegado." });
    }

    try {
        const securityFilter = getSecurityFilters(usuarioSolicitante);
        whereClause = { ...whereClause, ...securityFilter };
    } catch (e) {
        return res.status(400).json({ error: "Error de configuración." });
    }

    if (q) {
        whereClause.AND = [{ OR: [{ nombre: { contains: q } }] }];
    }

    const [total, usuarios] = await prisma.$transaction([
        prisma.usuario.count({ where: whereClause }),
        prisma.usuario.findMany({
          where: whereClause,
          take: limit,
          skip: offset,
          select: {
            id: true, nombre: true, username: true, email: true, 
            rol: true, cargo: true, estado: true, updatedAt: true, telefono: true,
            departamento: { select: { nombre: true } }
          },
          // CORRECCIÓN 4: Le pasamos el arreglo a Prisma
          orderBy: sort
        })
    ]);

    return res.json({ 
        status: "success",
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
        data: usuarios 
    });

  } catch (error) {
    await registrarError('LIST_INACTIVOS', req.user?.id || null, error);
    return res.status(500).json({ error: "Error al obtener usuarios inactivos" });
  }
};

export const getUsuarioById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params as unknown as GetUsuarioByIdParams;
    const usuarioSolicitante = req.user!;

    const whereClause: Prisma.UsuarioWhereInput = { id };

    switch (usuarioSolicitante.rol) {
      case Rol.SUPER_ADMIN: 
        break;
      case Rol.JEFE_MTTO:
        if (!usuarioSolicitante.departamentoId) return res.status(400).json({ error: "Sin depto" });
        whereClause.departamentoId = usuarioSolicitante.departamentoId;
        break;
      case Rol.COORDINADOR_MTTO:
        if (id === usuarioSolicitante.id) break; 
        if (!usuarioSolicitante.departamentoId) return res.status(400).json({ error: "Sin depto" });
        whereClause.departamentoId = usuarioSolicitante.departamentoId;
        whereClause.rol = Rol.TECNICO;
        break;
      case Rol.TECNICO:
      case Rol.CLIENTE_INTERNO:
        whereClause.id = usuarioSolicitante.id; 
        break;
      default:
        return res.status(403).json({ error: "Rol no autorizado." });
    }

    const usuario = await prisma.usuario.findFirst({
      where: whereClause,
      select: {
        id: true, nombre: true, username: true, imagen: true, email: true, 
        rol: true, cargo: true, estado: true, createdAt: true, updatedAt: true, telefono: true,
        departamento: { select: { id: true, nombre: true, planta: true, tipo: true } }, 
      }
    });

    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado o sin permiso." });

    return res.json(usuario);

  } catch (error) {
    await registrarError('GET_USUARIO_ID', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};