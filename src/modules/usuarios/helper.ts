import { Rol, Prisma } from "@prisma/client";
import { prisma } from "../../db";

export const getSecurityFilters = (usuario: { rol: Rol, departamentoId: number | null }): Prisma.UsuarioWhereInput | null => {
  switch (usuario.rol) {
    case Rol.SUPER_ADMIN: return {};
    case Rol.JEFE_MTTO:
    case Rol.COORDINADOR_MTTO:
      if (!usuario.departamentoId) throw new Error("Jefe/Coordinador sin departamento asignado");
      return { departamentoId: usuario.departamentoId };
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

  // ── Blindaje 1: SUPER_ADMIN no puede tener departamento, los demás sí ─────
  if (rolNuevo === Rol.SUPER_ADMIN) {
    if (datosNuevoUsuario.departamentoId != null) {
      throw new Error("El Super Admin no puede tener un departamento asignado.");
    }
  } else {
    if (datosNuevoUsuario.departamentoId == null) {
      throw new Error("El departamento es obligatorio para todos los usuarios excepto Super Admin.");
    }
  }

  // ── Blindaje 2: Validar tipo de departamento según rol ───────────────────
  if (rolNuevo !== Rol.SUPER_ADMIN && nombreDepartamentoObjetivo != null) {
    const deptoEsMtto = nombreDepartamentoObjetivo.toLowerCase().includes("mantenimiento");
    const esRolMtto = ([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO] as Rol[]).includes(rolNuevo);

    if (esRolMtto && !deptoEsMtto) {
      throw new Error("Los roles de Mantenimiento solo pueden pertenecer a un departamento de Mantenimiento.");
    }
    if (rolNuevo === Rol.CLIENTE_INTERNO && deptoEsMtto) {
      throw new Error("Los Clientes Internos no pueden pertenecer al departamento de Mantenimiento.");
    }
  }

  // ── Reglas por rol solicitante ────────────────────────────────────────────
  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN:
      return true;

    case Rol.JEFE_MTTO:
    case Rol.COORDINADOR_MTTO:
      if (datosNuevoUsuario.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("Solo puedes registrar personal para tu departamento asignado.");
      }
      const rolesPermitidosJefe: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO];
      if (!rolesPermitidosJefe.includes(rolNuevo)) {
        throw new Error("Como Jefe o Coordinador de Mantenimiento, solo puedes crear TÉCNICOS, COORDINADORES o JEFES.");
      }
      return true;

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
  datosNuevos: { rol?: string; departamentoId?: number | null; estado?: string },
  nombreDepartamentoObjetivo: string | null
) => {
  const esMismoUsuario = Number(usuarioSolicitante.id) === Number(usuarioObjetivo.id);
  const rolFinal = (datosNuevos.rol !== undefined ? datosNuevos.rol : usuarioObjetivo.rol) as Rol;

  // ── Blindaje 1: SUPER_ADMIN no puede tener departamento, los demás sí ─────
  if (rolFinal === Rol.SUPER_ADMIN) {
    if (datosNuevos.departamentoId !== undefined && datosNuevos.departamentoId !== null) {
      throw new Error("El Super Admin no puede tener un departamento asignado.");
    }
  } else {
    // Si no es Super Admin, el departamento es obligatorio
    if (datosNuevos.departamentoId === null || (datosNuevos.departamentoId === undefined && usuarioObjetivo.departamentoId === null)) {
      throw new Error("El departamento es obligatorio para todos los usuarios excepto Super Admin.");
    }
  }

  // ── Blindaje 2: Validar tipo de departamento según rol final ──────────────
  if (rolFinal !== Rol.SUPER_ADMIN && nombreDepartamentoObjetivo != null) {
    const deptoEsMtto = nombreDepartamentoObjetivo.toLowerCase().includes("mantenimiento");
    const esRolMtto = ([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO] as Rol[]).includes(rolFinal);

    if (esRolMtto && !deptoEsMtto) {
      throw new Error("Los roles de Mantenimiento solo pueden pertenecer a un departamento de Mantenimiento.");
    }
    if (rolFinal === Rol.CLIENTE_INTERNO && deptoEsMtto) {
      throw new Error("Los Clientes Internos no pueden pertenecer al departamento de Mantenimiento.");
    }
  }

  // ── Blindaje 3: Si ya era rol de mantenimiento y sigue siéndolo, su depto es fijo ─
  const eraMtto = ([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO] as Rol[]).includes(usuarioObjetivo.rol);
  const esMtto = ([Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO] as Rol[]).includes(rolFinal);
  if (
    usuarioSolicitante.rol !== Rol.SUPER_ADMIN &&
    eraMtto &&
    esMtto &&
    datosNuevos.departamentoId !== undefined &&
    datosNuevos.departamentoId !== usuarioObjetivo.departamentoId
  ) {
    throw new Error("El departamento de mantenimiento es fijo y no se puede modificar para este rol.");
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
    case Rol.COORDINADOR_MTTO:
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
        usuarioObjetivo.rol === Rol.SUPER_ADMIN
      ) {
        throw new Error("No tienes jerarquía suficiente para editar a un Super Admin.");
      }
      if (datosNuevos.rol) {
        const rolesPermitidos: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO];
        if (!rolesPermitidos.includes(datosNuevos.rol as Rol)) {
          throw new Error("Rol inválido. Solo puedes asignar: TÉCNICO, COORDINADOR o JEFE.");
        }
      }
      return true;

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
  if (usuarioSolicitante.rol === Rol.JEFE_MTTO || usuarioSolicitante.rol === Rol.COORDINADOR_MTTO) {
    if (usuarioObjetivo.departamentoId !== usuarioSolicitante.departamentoId) {
      throw new Error("Solo puedes desactivar usuarios de tu departamento.");
    }
    if (
      usuarioObjetivo.rol === Rol.SUPER_ADMIN
    ) {
      throw new Error("No tienes jerarquía suficiente para desactivar a un Super Admin.");
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