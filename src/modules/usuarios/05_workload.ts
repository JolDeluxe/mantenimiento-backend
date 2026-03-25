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

    // Usamos la relación exacta expuesta por tu schema: tareasAsignadas
    const usuarios = await prisma.usuario.findMany({
      where: whereUsuario,
      select: {
        id: true,
        nombre: true,
        imagen: true,
        cargo: true,
        rol: true,
        tareasAsignadas: {
          where: { estado: { in: ESTADOS_ACTIVOS } },
          select: { id: true, estado: true },
        },
      },
      orderBy: { nombre: "asc" },
    });

    const data = usuarios.map((u) => ({
      id: u.id,
      nombre: u.nombre,
      imagen: u.imagen,
      cargo: u.cargo,
      rol: u.rol,
      workload: {
        asignadas: u.tareasAsignadas.filter((t: { estado: EstadoTarea }) => t.estado === EstadoTarea.ASIGNADA).length,
        enProgreso: u.tareasAsignadas.filter((t: { estado: EstadoTarea }) => t.estado === EstadoTarea.EN_PROGRESO).length,
        enPausa: u.tareasAsignadas.filter((t: { estado: EstadoTarea }) => t.estado === EstadoTarea.EN_PAUSA).length,
      },
    }));

    return res.json({ status: "success", data });

  } catch (error) {
    await registrarError("GET_WORKLOAD", req.user?.id || null, error);
    return res.status(500).json({ error: "Error al obtener carga de trabajo" });
  }
};