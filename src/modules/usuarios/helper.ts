import { Rol } from "@prisma/client";

/**
 * Define los filtros de seguridad basados en el rol del usuario para LISTAR.
 */
export const getSecurityFilters = (usuario: any): any | null => {
  switch (usuario.rol) {
    case Rol.SUPER_ADMIN:
      return {}; 

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
    case Rol.CLIENTE_INTERNO:
      return null; 

    default:
      return null;
  }
};

/**
 * Define quien puede hacer que al momento de CREAR un usuario.
 */
export const validarReglasCreacion = (
  usuarioSolicitante: any, 
  datosNuevoUsuario: { rol: string, departamentoId: number | null },
  nombreDepartamentoObjetivo: string | null
) => {

  // --- REGLAS DE NEGOCIO GLOBALES PARA EL DEPARTAMENTO DE MANTENIMIENTO ---
  if (nombreDepartamentoObjetivo === "Mantenimiento" || nombreDepartamentoObjetivo === "Mantenimiento General") {
    // CORRECCIÓN: Tipar explícitamente como Rol[] para que .includes acepte cualquier Rol
    const rolesExclusivosMtto: Rol[] = [Rol.TECNICO, Rol.COORDINADOR_MTTO, Rol.JEFE_MTTO];

    if (!rolesExclusivosMtto.includes(datosNuevoUsuario.rol as Rol) && usuarioSolicitante.rol !== Rol.SUPER_ADMIN) {
        throw new Error("El departamento de Mantenimiento es exclusivo para roles operativos (Técnico, Coord, Jefe).");
    }
  }

  // --- PERMISOS POR JERARQUÍA ---
  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN:
      return true;

    case Rol.JEFE_MTTO:
      if (datosNuevoUsuario.departamentoId !== usuarioSolicitante.departamentoId) {
        throw new Error("Solo puedes registrar personal para tu departamento asignado.");
      }
      
      // CORRECCIÓN: Tipar explícitamente como Rol[]
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

/**
 * Define las reglas de negocio para ACTUALIZAR (EDITAR) un usuario.
 */
export const validarReglasEdicion = (
  usuarioSolicitante: any,
  usuarioObjetivo: any, 
  datosNuevos: any 
) => {

  // --- CASO 1: EDICIÓN DE UNO MISMO ---
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

  // --- CASO 2: EDICIÓN A OTROS ---
  switch (usuarioSolicitante.rol) {
    case Rol.SUPER_ADMIN:
      return true;

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
        // CORRECCIÓN: Tipar explícitamente como Rol[]
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

/**
 * Define las reglas para DESACTIVAR (PATCH estado) un usuario.
 */
export const validarReglasDesactivacion = (
  usuarioSolicitante: any,
  usuarioObjetivo: any
) => {

  if (usuarioSolicitante.id === usuarioObjetivo.id) {
    throw new Error("Seguridad: No puedes desactivar tu propia cuenta.");
  }

  if (usuarioSolicitante.rol === Rol.SUPER_ADMIN) {
    return true; 
  }

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