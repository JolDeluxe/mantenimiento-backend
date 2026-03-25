import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Estatus, Rol, Prisma } from "@prisma/client";
import { getSecurityFilters } from "./helper";
import { registrarError } from "../../utils/logger";
import type { ListUsuariosQuery, GetUsuarioByIdParams } from "./zod";

const ROL_HIERARCHY_ASC  = ['SUPER_ADMIN','JEFE_MTTO','COORDINADOR_MTTO','TECNICO','CLIENTE_INTERNO'] as const;
const ROL_HIERARCHY_DESC = [...ROL_HIERARCHY_ASC].reverse() as unknown as string[];

export const listarUsuarios = async (req: Request, res: Response) => {
  try {
    const usuarioSolicitante = req.user!;
    const { q, page, limit, rol, sort, estado, departamentoId, mtto } =
      req.query as unknown as ListUsuariosQuery;

    const offset = (page - 1) * limit;
    const targetEstatus = estado === Estatus.INACTIVO ? Estatus.INACTIVO : Estatus.ACTIVO;

    // ── 1. Filtros de seguridad + depto ───────────────────────────────────
    let baseWhere: Prisma.UsuarioWhereInput = { estado: targetEstatus };

    try {
      const securityFilter = getSecurityFilters(usuarioSolicitante);
      if (securityFilter === null)
        return res.status(403).json({ error: "Acceso denegado." });
      baseWhere = { ...baseWhere, ...securityFilter };
    } catch {
      return res.status(400).json({ error: "Error de configuración de usuario." });
    }

    if (usuarioSolicitante.rol === Rol.SUPER_ADMIN) {
      if (mtto) {
        const mttoDepto = await prisma.departamento.findFirst({
          where: { nombre: { contains: "Mantenimiento" } },
          select: { id: true },
        });
        if (mttoDepto) baseWhere.departamentoId = mttoDepto.id;
      } else if (departamentoId) {
        baseWhere.departamentoId = departamentoId;
      }
    }

    // ── 2. searchWhere incluye q ──────────────────────────────────────────
    const searchWhere: Prisma.UsuarioWhereInput = { ...baseWhere };

    if (q) {
      searchWhere.AND = [{
        OR: [
          { nombre: { contains: q } },
          { username: { contains: q } },
        ],
      }];
    }

    // ── 3. Conteos sobre searchWhere ──────────────────────────────────────
    const [totalAbsoluto, groupRoles] = await Promise.all([
      prisma.usuario.count({ where: searchWhere }),
      prisma.usuario.groupBy({
        by: ["rol"],
        _count: { id: true },
        where: searchWhere,
      }),
    ]);

    const resumenRoles = groupRoles.reduce((acc, curr) => {
      acc[curr.rol] = curr._count.id;
      return acc;
    }, {} as Record<string, number>);

    // ── 4. tableWhere agrega filtro de rol ────────────────────────────────
    const tableWhere: Prisma.UsuarioWhereInput = { ...searchWhere };

    if (rol) {
      // FIX: cuando el filtro de seguridad usa { in: [...] } (ej. COORDINADOR_MTTO),
      // comparar contra string siempre fallaba. Verificamos correctamente.
      if (baseWhere.rol) {
        const securityRol = baseWhere.rol as Prisma.UsuarioWhereInput['rol'];
        if (typeof securityRol === 'object' && securityRol !== null && 'in' in securityRol) {
          const allowedRoles = (securityRol as { in: string[] }).in ?? [];
          if (!allowedRoles.includes(rol)) {
            return res.json({
              status: "success",
              pagination: { total: 0, page, limit, totalPages: 0 },
              totalAbsoluto,
              resumenRoles,
              data: [],
            });
          }
        } else if (securityRol !== rol) {
          return res.json({
            status: "success",
            pagination: { total: 0, page, limit, totalPages: 0 },
            totalAbsoluto,
            resumenRoles,
            data: [],
          });
        }
      }
      tableWhere.rol = rol as Rol;
    }

    // ── 5. Ordenamiento ───────────────────────────────────────────────────
    const rolSortItem = sort.find(item => "rol" in item);
    const isSortByRol = !!rolSortItem;

    const orderBy: Prisma.UsuarioOrderByWithRelationInput[] = sort.map((item) => {
      if (item.departamento) {
        return { departamento: { nombre: item.departamento } } as Prisma.UsuarioOrderByWithRelationInput;
      }
      return item as Prisma.UsuarioOrderByWithRelationInput;
    });

    const sharedSelect = {
      id: true, nombre: true, username: true, imagen: true,
      email: true, rol: true, cargo: true, estado: true, telefono: true,
      departamentoId: true,
      departamento: { select: { id: true, nombre: true, planta: true, tipo: true } },
    } satisfies Prisma.UsuarioSelect;

    const totalPaginado = await prisma.usuario.count({ where: tableWhere });

    let usuarios: Prisma.UsuarioGetPayload<{ select: typeof sharedSelect }>[];

    if (isSortByRol) {
      const direction = rolSortItem!.rol === "desc" ? "desc" : "asc";
      const hierarchy = direction === "asc" ? ROL_HIERARCHY_ASC : ROL_HIERARCHY_DESC;
      const fieldExpr = Prisma.raw(
        `FIELD(rol, ${hierarchy.map(r => `'${r}'`).join(",")})`
      );

      const deptId = typeof tableWhere.departamentoId === "number"
        ? tableWhere.departamentoId : null;
      const rolFiltro = typeof tableWhere.rol === "string" ? tableWhere.rol : null;

      let whereFragment = Prisma.sql`estado = ${targetEstatus}`;
      if (deptId !== null)
        whereFragment = Prisma.sql`${whereFragment} AND departamentoId = ${deptId}`;
      if (rolFiltro)
        whereFragment = Prisma.sql`${whereFragment} AND rol = ${rolFiltro}`;
      if (q) {
        const like = `%${q}%`;
        whereFragment = Prisma.sql`${whereFragment} AND (nombre LIKE ${like} OR username LIKE ${like})`;
      }

      const rawRows = await prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM Usuario
        WHERE ${whereFragment}
        ORDER BY ${fieldExpr}
        LIMIT ${limit} OFFSET ${offset}
      `;

      const ids = rawRows.map(r => r.id);
      if (ids.length === 0) {
        usuarios = [];
      } else {
        const rawUsuarios = await prisma.usuario.findMany({
          where: { id: { in: ids } },
          select: sharedSelect,
        });
        const idIndex = new Map(ids.map((id, i) => [id, i]));
        usuarios = rawUsuarios.sort(
          (a, b) => (idIndex.get(a.id) ?? 0) - (idIndex.get(b.id) ?? 0)
        );
      }
    } else {
      usuarios = await prisma.usuario.findMany({
        where: tableWhere,
        take: limit,
        skip: offset,
        select: sharedSelect,
        orderBy,
      });
    }

    return res.json({
      status: "success",
      pagination: { total: totalPaginado, page, limit, totalPages: Math.ceil(totalPaginado / limit) },
      totalAbsoluto,
      resumenRoles,
      data: usuarios,
    });

  } catch (error) {
    await registrarError("LIST_USUARIOS", req.user?.id || null, error);
    return res.status(500).json({ error: "Error al obtener usuarios" });
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
        departamentoId: true,
        departamento: { select: { id: true, nombre: true, planta: true, tipo: true } },
      },
    });

    if (!usuario) return res.status(404).json({ error: "Usuario no encontrado o sin permiso." });

    return res.json(usuario);

  } catch (error) {
    await registrarError('GET_USUARIO_ID', req.user?.id || null, error);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
};