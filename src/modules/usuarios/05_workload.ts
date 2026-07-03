// src/modules/usuarios/05_workload.ts
import type { Request, Response } from "express";
import { prisma } from "../../db";
import { Rol, EstadoTarea, Estatus, Prisma } from "@prisma/client";
import { registrarError } from "../../utils/logger";

const ROLES_ASIGNABLES: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO];
const ESTADOS_ACTIVOS: EstadoTarea[] = [EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.EN_PAUSA];

/**
 * GET /api/usuarios/workload
 * Devuelve técnicos y coordinadores activos del scope del usuario,
 * junto con su carga de trabajo.
 */
export const getWorkload = async (req: Request, res: Response) => {
  try {
    const user = req.user!;

    const rolesPermitidos: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
    if (!rolesPermitidos.includes(user.rol)) {
      return res.status(403).json({ error: "Acceso denegado." });
    }

    const whereUsuario: Prisma.UsuarioWhereInput = {
      rol: { in: ROLES_ASIGNABLES },
      estado: Estatus.ACTIVO, 
    };

    if (user.rol === Rol.JEFE_MTTO || user.rol === Rol.COORDINADOR_MTTO) {
      if (!user.departamentoId) {
        return res.status(400).json({ error: "Usuario sin departamento asignado." });
      }
      whereUsuario.departamentoId = user.departamentoId;
    }

    const usuarios = await prisma.usuario.findMany({
      where: whereUsuario,
      select: {
        id: true,
        nombre: true,
        imagen: true,
        cargo: true,
        rol: true,
      },
      orderBy: { nombre: "asc" },
    });

    const usuarioIds = usuarios.map((u) => u.id);
    const workloadRows = usuarioIds.length > 0
      ? await prisma.$queryRaw<Array<{ usuarioId: number; estado: EstadoTarea; total: bigint }>>(Prisma.sql`
          SELECT r.B AS usuarioId, t.estado AS estado, COUNT(*) AS total
          FROM _responsables r
          INNER JOIN Tarea t ON t.id = r.A
          WHERE r.B IN (${Prisma.join(usuarioIds)})
            AND t.estado IN (${Prisma.join(ESTADOS_ACTIVOS)})
          GROUP BY r.B, t.estado
        `)
      : [];

    const workloadByUser = new Map<number, { asignadas: number; enProgreso: number; enPausa: number }>();
    for (const row of workloadRows) {
      const workload = workloadByUser.get(row.usuarioId) ?? { asignadas: 0, enProgreso: 0, enPausa: 0 };
      if (row.estado === EstadoTarea.ASIGNADA) workload.asignadas = Number(row.total);
      if (row.estado === EstadoTarea.EN_PROGRESO) workload.enProgreso = Number(row.total);
      if (row.estado === EstadoTarea.EN_PAUSA) workload.enPausa = Number(row.total);
      workloadByUser.set(row.usuarioId, workload);
    }

    const data = usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      imagen: u.imagen,
      cargo: u.cargo,
      rol: u.rol,
      workload: workloadByUser.get(u.id) ?? { asignadas: 0, enProgreso: 0, enPausa: 0 },
    }));

    return res.json({ status: "success", data });

  } catch (error) {
    await registrarError("GET_WORKLOAD", req.user?.id || null, error);
    return res.status(500).json({ error: "Error al obtener carga de trabajo" });
  }
};
