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
        rol: { in: [Rol.TECNICO, Rol.COORDINADOR_MTTO] },
      };
    case Rol.TECNICO:
    case Rol.CLIENTE_INTERNO:
      return null;
    default:
      return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPER INTERNO: conjunto de roles cuyo departamento es fijo (Mantenimiento)
// Solo CLIENTE_INTERNO tiene departamento operativo variable.
// ─────────────────────────────────────────────────────────────────────────────
const ROLES_DEPTO_FIJO: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO, Rol.SUPER_ADMIN];

export const validarReglasCreacion = (
  usuarioSolicitante: { rol: Rol; departamentoId: number | null },
  datosNuevoUsuario: { rol: string; departamentoId: number | null },
  nombreDepartamentoObjetivo: string | null
) => {
  const rolNuevo = datosNuevoUsuario.rol as Rol;

  // ── Blindaje 1: SUPER_ADMIN no puede tener departamento ───────────────────
  if (rolNuevo === Rol.SUPER_ADMIN && datosNuevoUsuario.departamentoId != null) {
    throw new Error("El Super Admin no puede tener un departamento asignado.");
  }

  // ── Blindaje 2: Roles de Mantenimiento → solo depto Mantenimiento ─────────
  const rolesMantenimiento: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO];
  if (
    rolesMantenimiento.includes(rolNuevo) &&
    datosNuevoUsuario.departamentoId != null &&
    nombreDepartamentoObjetivo != null &&
    !nombreDepartamentoObjetivo.toLowerCase().includes("mantenimiento")
  ) {
    throw new Error(
      "Los roles de Mantenimiento solo pueden pertenecer a un departamento de Mantenimiento."
    );
  }

  // ── Blindaje 3: CLIENTE_INTERNO no puede estar en Mantenimiento ───────────
  if (
    rolNuevo === Rol.CLIENTE_INTERNO &&
    (nombreDepartamentoObjetivo === "Mantenimiento" ||
      nombreDepartamentoObjetivo === "Mantenimiento General")
  ) {
    throw new Error(
      "Los Clientes Internos no pueden pertenecer al departamento de Mantenimiento."
    );
  }

  // ── Reglas por rol solicitante ────────────────────────────────────────────
  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN:
      return true;

    case Rol.JEFE_MTTO:
      if (datosNuevoUsuario.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("Solo puedes registrar personal para tu departamento asignado.");
      }
      const rolesPermitidosJefe: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO];
      if (!rolesPermitidosJefe.includes(rolNuevo)) {
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
  usuarioSolicitante: { id: number; rol: Rol; departamentoId: number | null },
  usuarioObjetivo: { id: number; rol: Rol; departamentoId: number | null; estado?: string },
  datosNuevos: { rol?: string; departamentoId?: number | null; estado?: string }
) => {
  const esMismoUsuario = Number(usuarioSolicitante.id) === Number(usuarioObjetivo.id);

  // ── Blindaje Central: departamento solo editable para CLIENTE_INTERNO ─────
  // Un usuario con rol de Mantenimiento tiene su departamento fijo en la
  // estructura organizacional. Solo CLIENTE_INTERNO puede cambiar de depto
  // porque representa a distintas áreas de producción / administración.
  // Este blindaje aplica ANTES que cualquier otro, incluyendo al SUPER_ADMIN
  // sobre usuarios de mantenimiento (la jerarquía no exime la regla de negocio).
  if (datosNuevos.departamentoId !== undefined) {
    const rolEfectivo = (datosNuevos.rol ?? usuarioObjetivo.rol) as Rol;
    if (ROLES_DEPTO_FIJO.includes(rolEfectivo)) {
      throw new Error(
        "El departamento no puede modificarse para este rol. Solo aplica a usuarios con rol Cliente Interno."
      );
    }
  }

  // ── Reglas de auto-edición ────────────────────────────────────────────────
  if (esMismoUsuario) {
    if (
      datosNuevos.rol &&
      datosNuevos.rol !== usuarioObjetivo.rol &&
      usuarioSolicitante.rol !== Rol.SUPER_ADMIN
    ) {
      throw new Error("No tienes permisos para cambiar tu propio rol.");
    }
    if (datosNuevos.estado && datosNuevos.estado !== usuarioObjetivo.estado && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
      throw new Error("No puedes cambiar tu propio estatus.");
    }
    return true;
  }

  // ── Reglas por rol solicitante ────────────────────────────────────────────
  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN:
      return true;

    case Rol.JEFE_MTTO:
      if (usuarioObjetivo.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("No tienes permisos para editar usuarios de otros departamentos.");
      }
      if (
        datosNuevos.departamentoId !== undefined &&
        datosNuevos.departamentoId !== usuarioObjetivo.departamentoId
      ) {
        throw new Error("No puedes transferir usuarios a otros departamentos.");
      }
      if (
        usuarioObjetivo.rol === Rol.SUPER_ADMIN ||
        usuarioObjetivo.rol === Rol.JEFE_MTTO
      ) {
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
  usuarioSolicitante: { id: number; rol: Rol; departamentoId: number | null },
  usuarioObjetivo: { id: number; rol: Rol; departamentoId: number | null }
) => {
  if (Number(usuarioSolicitante.id) === Number(usuarioObjetivo.id)) {
    throw new Error("Seguridad: No puedes desactivar tu propia cuenta.");
  }
  if (usuarioSolicitante.rol === Rol.SUPER_ADMIN) return true;
  if (usuarioSolicitante.rol === Rol.JEFE_MTTO) {
    if (usuarioObjetivo.departamentoId !== usuarioSolicitante.departamentoId) {
      throw new Error("Solo puedes desactivar usuarios de tu departamento.");
    }
    if (
      usuarioObjetivo.rol === Rol.SUPER_ADMIN ||
      usuarioObjetivo.rol === Rol.JEFE_MTTO
    ) {
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
    select: { id: true },
  });
  return usuario ? usuario.id : null;
};