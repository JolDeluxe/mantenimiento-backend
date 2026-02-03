import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Estatus, Rol } from "@prisma/client";
import { getSecurityFilters } from "./helper"; 
import { registrarError } from "../../utils/logger";

// --- TRAE LA LISTA DE USUARIOS ACTIVOS ---
export const listarUsuarios = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const rolFiltrado = req.query.rol as string | undefined;
    const { q, page, limit } = req.query;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    let whereClause: any = {
      estado: Estatus.ACTIVO
    };

    try {
      const securityFilter = getSecurityFilters(usuarioSolicitante);
      if (securityFilter === null) return res.status(403).json({ error: "Acceso denegado." });
      whereClause = { ...whereClause, ...securityFilter };
    } catch (e) {
      return res.status(400).json({ error: "Error de configuración de usuario." });
    }

    if (rolFiltrado) {
      // Validación segura del Enum
      if (!Object.values(Rol).includes(rolFiltrado as Rol)) {
        return res.status(400).json({ error: `El rol '${rolFiltrado}' no es válido.` });
      }
      
      // Si el filtro de seguridad ya forzó un rol y piden otro, devolvemos vacío
      if (whereClause.rol && whereClause.rol !== rolFiltrado) {
         return res.json({ 
             status: "success",
             pagination: { total: 0, page: pageNum, limit: limitNum, totalPages: 0 },
             data: [] 
         });
      }
      whereClause.rol = rolFiltrado as Rol;
    }

    if (q && typeof q === 'string') {
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
        take: limitNum,
        skip: offset,
        select: {
          id: true, nombre: true, username: true, imagen: true, 
          email: true, rol: true, cargo: true, estado: true,
          telefono: true,
          departamento: { select: { nombre: true, planta: true, tipo: true } },
        },
        orderBy: { nombre: 'asc' } 
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
      data: usuarios 
    });

  } catch (error) {
    await registrarError('LIST_USUARIOS', req.user?.id || null, error);
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
};

// --- TRAE LA LISTA DE USUARIOS INACTIVOS ---
export const listarInactivos = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    
    const { q, page, limit } = req.query;
    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.max(1, Number(limit) || 20);
    const offset = (pageNum - 1) * limitNum;

    let whereClause: any = {
      estado: Estatus.INACTIVO
    };

    if (usuarioSolicitante.rol !== Rol.SUPER_ADMIN && usuarioSolicitante.rol !== Rol.JEFE_MTTO) {
        return res.status(403).json({ error: "Acceso denegado." });
    }

    try {
        const securityFilter = getSecurityFilters(usuarioSolicitante);
        whereClause = { ...whereClause, ...securityFilter };
    } catch (e) {
        return res.status(400).json({ error: "Error de configuración." });
    }

    if (q && typeof q === 'string') {
        whereClause.AND = [{
            OR: [
              { nombre: { contains: q } }
            ]
        }];
    }

    const [total, usuarios] = await prisma.$transaction([
        prisma.usuario.count({ where: whereClause }),
        prisma.usuario.findMany({
          where: whereClause,
          take: limitNum,
          skip: offset,
          select: {
            id: true, nombre: true, username: true, email: true, 
            rol: true, cargo: true, estado: true, updatedAt: true, 
            telefono: true,
            departamento: { select: { nombre: true } }
          },
          orderBy: { updatedAt: 'desc' }
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
        data: usuarios 
    });

  } catch (error) {
    await registrarError('LIST_INACTIVOS', req.user?.id || null, error);
    res.status(500).json({ error: "Error al obtener usuarios inactivos" });
  }
};

// --- BUSCA POR ID ---
export const getUsuarioById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const usuarioIdObjetivo = Number(id);
    const usuarioSolicitante = req.user!;

    if (isNaN(usuarioIdObjetivo)) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const whereClause: any = {
      id: usuarioIdObjetivo
    };

    switch (usuarioSolicitante.rol) {
      case Rol.SUPER_ADMIN: 
        break;

      case Rol.JEFE_MTTO:
        if (!usuarioSolicitante.departamentoId) return res.status(400).json({ error: "Sin depto" });
        whereClause.departamentoId = usuarioSolicitante.departamentoId;
        break;

      case Rol.COORDINADOR_MTTO:
        if (usuarioIdObjetivo === usuarioSolicitante.id) {
           break; 
        }
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
        rol: true, cargo: true, estado: true, createdAt: true, updatedAt: true,
        telefono: true,
        departamento: { select: { id: true, nombre: true, planta: true, tipo: true } }, 
      }
    });

    if (!usuario) {
      return res.status(404).json({ error: "Usuario no encontrado o sin permiso." });
    }

    res.json(usuario);

  } catch (error) {
    await registrarError('GET_USUARIO_ID', req.user?.id || null, error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};