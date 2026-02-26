import { Rol, Prisma } from "@prisma/client";
import { prisma } from "../../db";

export const getSecurityFilters = (usuario: { rol: Rol, departamentoId: number | null }): Prisma.UsuarioWhereInput | null => {
  switch (usuario.rol) {
    case Rol.SUPER_ADMIN: return {}; 
    case Rol.JEFE_MTTO:
      if (!usuario.departamentoId) throw new Error("Jefe sin departamento asignado");
      return { departamentoId: usuario.departamentoId };
    case Rol.COORDINADOR_MTTO:
      if (!usuario.departamentoId) throw new Error("Coordinador sin departamento asignado");
      return {
        departamentoId: usuario.departamentoId,
        rol: { in: [Rol.TECNICO, Rol.COORDINADOR_MTTO] } 
      };
    case Rol.TECNICO:
    case Rol.CLIENTE_INTERNO: return null; 
    default: return null;
  }
};

export const validarReglasCreacion = (
  usuarioSolicitante: { rol: Rol, departamentoId: number | null }, 
  datosNuevoUsuario: { rol: string, departamentoId: number | null },
  nombreDepartamentoObjetivo: string | null
) => {
  if (nombreDepartamentoObjetivo === "Mantenimiento" || nombreDepartamentoObjetivo === "Mantenimiento General") {
    const rolesExclusivosMtto: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO];
    if (!rolesExclusivosMtto.includes(datosNuevoUsuario.rol as Rol) && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
        throw new Error("El departamento de Mantenimiento es exclusivo para roles operativos (Técnico, Coord, Jefe).");
    }
  }

  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN: return true;
    case Rol.JEFE_MTTO:
      if (datosNuevoUsuario.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("Solo puedes registrar personal para tu departamento asignado.");
      }
      const rolesPermitidosJefe: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO];
      if (!rolesPermitidosJefe.includes(datosNuevoUsuario.rol as Rol)) {
        throw new Error("Como Jefe de Mantenimiento, solo puedes crear TÉCNICOS o COORDINADORES.");
      }
      return true;
    case Rol.COORDINADOR_MTTO:
    case Rol.TECNICO:
    case Rol.CLIENTE_INTERNO:
      throw new Error("No tienes permisos para crear usuarios.");
    default:
      throw new Error("Rol desconocido, acción denegada.");
  }
};

export const validarReglasEdicion = (
  usuarioSolicitante: { id: number, rol: Rol, departamentoId: number | null },
  usuarioObjetivo: { id: number, rol: Rol, departamentoId: number | null }, 
  datosNuevos: { rol?: string, departamentoId?: number | null, estado?: string } 
) => {
  if (usuarioSolicitante.id === usuarioObjetivo.id) {
    if (datosNuevos.rol && datosNuevos.rol !== usuarioObjetivo.rol && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
      throw new Error("No tienes permisos para cambiar tu propio rol.");
    }
    if (datosNuevos.departamentoId && datosNuevos.departamentoId !== usuarioObjetivo.departamentoId && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
      throw new Error("No tienes permisos para cambiarte de departamento.");
    }
    if (datosNuevos.estado && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
      throw new Error("No puedes cambiar tu propio estatus.");
    }
    return true; 
  }

  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN: return true;
    case Rol.JEFE_MTTO:
      if (usuarioObjetivo.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("No tienes permisos para editar usuarios de otros departamentos.");
      }
      if (datosNuevos.departamentoId && datosNuevos.departamentoId !== usuarioObjetivo.departamentoId) {
        throw new Error("No puedes transferir usuarios a otros departamentos.");
      }
      if (usuarioObjetivo.rol === Rol.SUPER_ADMIN || usuarioObjetivo.rol === Rol.JEFE_MTTO) {
        throw new Error("No tienes jerarquía suficiente para editar a este usuario.");
      }
      if (datosNuevos.rol) {
        const rolesPermitidos: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO];
        if (!rolesPermitidos.includes(datosNuevos.rol as Rol)) {
           throw new Error("Rol inválido. Solo puedes asignar: TÉCNICO o COORDINADOR.");
        }
      }
      return true;
    case Rol.COORDINADOR_MTTO:
    case Rol.TECNICO:
    case Rol.CLIENTE_INTERNO:
      throw new Error("Acceso denegado. No tienes permisos para editar usuarios.");
    default:
      throw new Error("Rol no autorizado.");
  }
};

export const validarReglasDesactivacion = (
  usuarioSolicitante: { id: number, rol: Rol, departamentoId: number | null },
  usuarioObjetivo: { id: number, rol: Rol, departamentoId: number | null }
) => {
  if (usuarioSolicitante.id === usuarioObjetivo.id) {
    throw new Error("Seguridad: No puedes desactivar tu propia cuenta.");
  }
  if (usuarioSolicitante.rol === Rol.SUPER_ADMIN) return true; 
  if (usuarioSolicitante.rol === Rol.JEFE_MTTO) {
    if (usuarioObjetivo.departamentoId !== usuarioSolicitante.departamentoId) {
      throw new Error("Solo puedes desactivar usuarios de tu departamento.");
    }
    if (usuarioObjetivo.rol === Rol.SUPER_ADMIN || usuarioObjetivo.rol === Rol.JEFE_MTTO) {
      throw new Error("No tienes jerarquía suficiente para desactivar a este usuario.");
    }
    return true;
  }
  throw new Error("Acceso denegado. No tienes permisos para cambiar el estatus de usuarios.");
};

export const obtenerIdsPorRol = async (roles: Rol[]): Promise<number[]> => {
  const usuarios = await prisma.usuario.findMany({
    where: { rol: { in: roles }, estado: "ACTIVO" },
    select: { id: true },
  });
  return usuarios.map((u) => u.id);
};

export const obtenerIdUsuarioActivo = async (id: number): Promise<number | null> => {
  const usuario = await prisma.usuario.findUnique({
    where: { id, estado: "ACTIVO" },
    select: { id: true }
  });
  return usuario ? usuario.id : null;
};