import { prisma } from "../db";
import { 
  EstadoTarea, 
  Prioridad, 
  TipoTarea, 
  ClasificacionTarea, 
  Rol,
  TipoEvento
} from "@prisma/client";

/**
 * Script de Poblado de Tareas (Seeding)
 * Ejecutar con: bun src/test/populate_tickets.ts
 */
async function main() {
  console.log("🚀 Iniciando generación de escenarios de prueba...");

  // 1. OBTENER USUARIOS REALES
  const admin = await prisma.usuario.findFirst({ where: { rol: Rol.SUPER_ADMIN } });
  const jefe = await prisma.usuario.findFirst({ where: { rol: Rol.JEFE_MTTO } });
  const coordinador = await prisma.usuario.findFirst({ where: { rol: Rol.COORDINADOR_MTTO } });
  const cliente = await prisma.usuario.findFirst({ where: { rol: Rol.CLIENTE_INTERNO } });
  
  // Obtenemos técnicos. Usamos 'take: 5' para intentar tener suficientes.
  const tecnicos = await prisma.usuario.findMany({ 
    where: { rol: Rol.TECNICO },
    take: 5
  });

  if (!admin || !cliente || tecnicos.length === 0) {
    console.error("❌ ERROR: Faltan usuarios requeridos (Admin, Cliente o Técnicos).");
    process.exit(1);
  }

  // Helpers seguros para obtener técnicos sin que TS se queje de undefined
  const tec1 = tecnicos[0];
  const tec2 = tecnicos.length > 1 ? tecnicos[1] : tecnicos[0];

  console.log(`✅ Usuarios cargados. Usando ${tecnicos.length} técnicos.`);

  // DEFINICIÓN DE LAS 15 TAREAS (CON ENUMS VÁLIDOS)
  const tareasData = [
    // --- ESCENARIO 1: TICKET BÁSICO ---
    {
      titulo: "Fuga de aire en compresor principal",
      descripcion: "Se escucha un silbido fuerte en la línea de aire de Pespunte.",
      prioridad: Prioridad.ALTA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.PENDIENTE,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      planta: "KAPPA",
      area: "PESPUNTE",
      creadorId: cliente.id,
      responsables: [] // Sin asignar
    },
    // --- ESCENARIO 2: TICKET EN PROGRESO ---
    {
      titulo: "Computadora de corte láser no enciende",
      descripcion: "La pantalla se queda en negro, urge revisar.",
      prioridad: Prioridad.ALTA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.EN_PROGRESO,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      planta: "SIGMA",
      area: "LASER Y BORDADO",
      creadorId: cliente.id,
      responsables: [tec1]
    },
    // --- ESCENARIO 3: TAREA PLANEADA ---
    {
      titulo: "Mantenimiento Preventivo Banda Transportadora",
      descripcion: "Limpieza y lubricación mensual de la banda de montaje.",
      prioridad: Prioridad.MEDIA,
      tipo: TipoTarea.PLANEADA,
      estado: EstadoTarea.ASIGNADA,
      clasificacion: ClasificacionTarea.PREVENTIVO,
      planta: "KAPPA",
      area: "MONTADO",
      creadorId: jefe?.id || admin.id,
      responsables: [tec1]
    },
    // --- ESCENARIO 4: TAREA EXTRAORDINARIA ---
    {
      titulo: "Instalación de nueva iluminación LED",
      descripcion: "Proyecto de mejora de iluminación en nave industrial.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.EXTRAORDINARIA,
      estado: EstadoTarea.EN_PAUSA,
      clasificacion: ClasificacionTarea.MEJORA,
      planta: "KAPPA",
      area: "NAVE CENTRAL",
      creadorId: coordinador?.id || admin.id,
      responsables: tecnicos // Todos los técnicos
    },
    // --- ESCENARIO 5: TICKET RESUELTO ---
    {
      titulo: "Baño de mujeres atascado",
      descripcion: "El inodoro 3 no baja agua.",
      prioridad: Prioridad.MEDIA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.RESUELTO,
      clasificacion: ClasificacionTarea.INFRAESTRUCTURA,
      planta: "ADMINISTRATIVOS",
      area: "CAPITAL HUMANO",
      creadorId: cliente.id,
      responsables: [tec1]
    },
    // --- ESCENARIO 6: TICKET CERRADO ---
    {
      titulo: "Cambio de chapa puerta principal",
      descripcion: "La llave se atoraba.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.CERRADO,
      clasificacion: ClasificacionTarea.INFRAESTRUCTURA,
      planta: "ADMINISTRATIVOS",
      area: "ADMINISTRACION",
      creadorId: cliente.id,
      responsables: [tec1],
      finalizadoAt: new Date()
    },
    // --- ESCENARIO 7: TICKET RECHAZADO ---
    {
      titulo: "Solicitud de café para reunión",
      descripcion: "Necesitamos café para la junta de las 10.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.RECHAZADO,
      clasificacion: ClasificacionTarea.RUTINA, 
      planta: "ADMINISTRATIVOS",
      area: "OFICINA CALIDAD",
      creadorId: cliente.id,
      responsables: [],
      finalizadoAt: new Date()
    },
    // --- ESCENARIO 8: OTRA PLANTA (OMEGA) ---
    {
      titulo: "Ruido en montacargas",
      descripcion: "El montacargas eléctrico hace ruido al girar.",
      prioridad: Prioridad.MEDIA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.PENDIENTE,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      planta: "OMEGA",
      area: "ALMACEN DE PIELES",
      creadorId: cliente.id,
      responsables: []
    },
    // --- ESCENARIO 9: OTRA PLANTA (LAMBDA) ---
    {
      titulo: "Máquina de coser descalibrada",
      descripcion: "Rompe las agujas constantemente.",
      prioridad: Prioridad.ALTA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.EN_PROGRESO,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      planta: "LAMBDA",
      area: "BOLSAS Y BILLETERAS",
      creadorId: cliente.id,
      responsables: [tec2]
    },
    // --- ESCENARIO 10: TAREA VENCIDA ---
    {
      titulo: "Revisión extintores (VENCIDA)",
      descripcion: "Debió hacerse la semana pasada.",
      prioridad: Prioridad.ALTA,
      tipo: TipoTarea.PLANEADA,
      estado: EstadoTarea.ASIGNADA,
      clasificacion: ClasificacionTarea.INSPECCION, 
      planta: "KAPPA",
      area: "GENERAL",
      creadorId: admin.id,
      responsables: [tec1],
      fechaVencimiento: new Date("2023-01-01")
    },
    // --- ESCENARIO 11: PROYECTO (Ahora EXTRAORDINARIA) ---
    {
      titulo: "Instalación Paneles Solares",
      descripcion: "Proyecto de sustentabilidad 2026.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.EXTRAORDINARIA, 
      estado: EstadoTarea.PENDIENTE,
      clasificacion: ClasificacionTarea.MEJORA,
      planta: "GENERAL",
      area: "TECHO",
      creadorId: admin.id,
      responsables: [],
      fechaVencimiento: new Date("2026-12-31")
    },
    // --- ESCENARIO 12: INSPECCIÓN CALIDAD ---
    {
      titulo: "Calibración Mesas de Trabajo",
      descripcion: "Revisión de nivelación.",
      prioridad: Prioridad.MEDIA,
      tipo: TipoTarea.PLANEADA,
      estado: EstadoTarea.ASIGNADA,
      clasificacion: ClasificacionTarea.INSPECCION,
      planta: "KAPPA",
      area: "CALIDAD MESAS DE TRABAJO",
      creadorId: coordinador?.id || admin.id,
      responsables: [tec1]
    },
    // --- ESCENARIO 13: LIMPIEZA / 5S ---
    {
      titulo: "Jornada de Limpieza Profunda",
      descripcion: "Retiro de material obsoleto.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.EXTRAORDINARIA,
      estado: EstadoTarea.RESUELTO,
      clasificacion: ClasificacionTarea.RUTINA, 
      planta: "OMEGA",
      area: "PT",
      creadorId: jefe?.id || admin.id,
      responsables: [tec1, tec2]
    },
    // --- ESCENARIO 14: TICKET CANCELADO ---
    {
      titulo: "Prueba de sistema (Ignorar)",
      descripcion: "Ticket creado por error.",
      prioridad: Prioridad.BAJA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.CANCELADA,
      clasificacion: ClasificacionTarea.RUTINA,
      planta: "KAPPA",
      area: "SISTEMAS",
      creadorId: admin.id,
      responsables: []
    },
    // --- ESCENARIO 15: URGENTE SIN ASIGNAR ---
    {
      titulo: "FUGA DE GAS EN COMEDOR",
      descripcion: "Olor a gas fuerte, cerrar válvulas.",
      prioridad: Prioridad.ALTA,
      tipo: TipoTarea.TICKET,
      estado: EstadoTarea.PENDIENTE,
      clasificacion: ClasificacionTarea.INFRAESTRUCTURA, 
      planta: "KAPPA",
      area: "COMEDOR",
      creadorId: cliente.id,
      responsables: []
    }
  ];

  console.log("🛠️ Insertando tareas...");

  for (const t of tareasData) {
    // CORRECCIÓN DEFINITIVA:
    // 1. Filtramos los undefined.
    // 2. Usamos u!.id (con signo de admiración) para decirle a TS que estamos seguros que no es undefined.
    const responsablesConnect = t.responsables
      .filter(u => u !== undefined)
      .map(u => ({ id: u!.id }));

    // Desestructuramos para quitar 'responsables' del objeto original
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { responsables, ...dataTarea } = t;

    await prisma.tarea.create({
      data: {
        ...dataTarea,
        departamentoId: 1, 
        responsables: {
          connect: responsablesConnect
        },
        historial: {
          create: {
            usuarioId: admin.id,
            tipo: TipoEvento.CREACION,
            estadoNuevo: t.estado,
            nota: "Tarea generada automáticamente por Test Seed"
          }
        }
      }
    });
  }

  console.log("✅ ¡15 Tareas creadas exitosamente!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });