import { 
  EstadoTarea, 
  Rol, 
  Prisma, 
  Prioridad, 
  TipoTarea, 
  ClasificacionTarea 
} from "@prisma/client";

// --- REGLAS DE SEGURIDAD Y PRIVILEGIOS ---

/**
 * Valida si el rol tiene privilegios administrativos en Mantenimiento.
 */
export const isAdminOrJefe = (rol: Rol): boolean => {
  const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
  return rolesAdmin.includes(rol);
};

/**
 * Helper para verificar si es técnico (Para limpiar importaciones externas si se requiere)
 */
export const isTecnico = (rol: Rol): boolean => {
  return rol === Rol.TECNICO;
};

// --- FILTROS DE BASE DE DATOS ---

/**
 * Construye el objeto 'where' para Prisma basado en el usuario y los query params.
 */
export const getTicketFilters = (user: { id: number; rol: Rol }, query: any): Prisma.TareaWhereInput => {
  const { 
    q, estado, prioridad, tipo, clasificacion, responsableId,
    fechaInicio, fechaFin 
  } = query;

  let where: Prisma.TareaWhereInput = {};

  // 1. Filtros de Seguridad por Rol
  if (user.rol === Rol.TECNICO) {
    where.responsables = { some: { id: user.id } };
  } else if (user.rol === Rol.CLIENTE_INTERNO) {
    where.creadorId = user.id;
  }

  // 2. Filtros de Atributos
  if (prioridad) where.prioridad = prioridad as Prioridad;
  if (estado) where.estado = estado as EstadoTarea;
  if (tipo) where.tipo = tipo as TipoTarea;
  if (clasificacion) where.clasificacion = clasificacion as ClasificacionTarea;

  if (responsableId) {
    const rId = Number(responsableId);
    if (!isNaN(rId)) {
      where.responsables = { some: { id: rId } };
    }
  }

  // 3. Filtros de Fecha
  if (fechaInicio || fechaFin) {
    where.createdAt = {};
    if (fechaInicio) where.createdAt.gte = new Date(fechaInicio);
    if (fechaFin) {
      const endDay = new Date(fechaFin);
      endDay.setHours(23, 59, 59, 999);
      where.createdAt.lte = endDay;
    }
  }

  // 4. Búsqueda Global (q)
  if (q && typeof q === 'string') {
    const isNumber = !isNaN(Number(q));
    where.AND = [
      {
        OR: [
          { titulo: { contains: q } },
          { descripcion: { contains: q } },
          { planta: { contains: q } },
          { area: { contains: q } },
          { creador: { nombre: { contains: q } } },
          ...(isNumber ? [{ id: Number(q) }] : [])
        ]
      }
    ];
  }

  return where;
};

// --- TRANSICIONES DE ESTADO ---

/**
 * Valida si la transición de estado es permitida por el flujo de trabajo.
 */
export const isValidTransition = (current: EstadoTarea, next: EstadoTarea): boolean => {
  const map: Record<EstadoTarea, EstadoTarea[]> = {
    [EstadoTarea.PENDIENTE]:   [EstadoTarea.ASIGNADA, EstadoTarea.CANCELADA],
    [EstadoTarea.ASIGNADA]:    [EstadoTarea.EN_PROGRESO, EstadoTarea.PENDIENTE, EstadoTarea.CANCELADA], 
    [EstadoTarea.EN_PROGRESO]: [EstadoTarea.EN_PAUSA, EstadoTarea.RESUELTO],
    [EstadoTarea.EN_PAUSA]:    [EstadoTarea.EN_PROGRESO],
    [EstadoTarea.RESUELTO]:    [EstadoTarea.CERRADO, EstadoTarea.RECHAZADO],
    [EstadoTarea.RECHAZADO]:   [EstadoTarea.EN_PROGRESO, EstadoTarea.CANCELADA],
    [EstadoTarea.CERRADO]:     [], 
    [EstadoTarea.CANCELADA]:   [] 
  };

  return map[current]?.includes(next) || false;
};


// OMEGA:
// {
//   PT 
// }

// SIGMA: 
// {
//   PRELIMINARES
//   LASER Y BORDADO
// }

// LAMBDA:
// {
//   BOLSAS Y BILLETERAS
// }

// KAPPA:
// {
//   OPERTATIVOS
//   {
//     ACABADO
//     ACABADO
//     ALMACEN DE MATERIA PRIMA
//     ALMACEN DE PIELES
//     BORDADO
//     CALIDAD MESAS DE TRABAJO EN PRODUCCION
//     CELULA DESARROLLO
//     CHAMARRAS
//     CINTOS
//     CORTE
//     LASER
//     PESPUNTE
//     MONTADO
//     PRELIMINARES
//   }

//   ADMINISTRATIVOS
//   {
//     ADMINISTRACION
//     CAPITAL HUMANO
//     IMAGEN - DISEÑO
//     OFICINA CALIDAD
//     MANTENIMIENTO
//   }
  
// }

