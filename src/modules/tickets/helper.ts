import { EstadoTarea, Rol } from "@prisma/client";

//Valida si la transición de estado de un ticket es lógica según el flujo de negocio.
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

export const isAdminOrJefe = (rol: Rol): boolean => {
  const rolesAdmin: Rol[] = [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO];
  return rolesAdmin.includes(rol);
};

export const isTecnico = (rol: Rol): boolean => {
  return rol === Rol.TECNICO;
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

