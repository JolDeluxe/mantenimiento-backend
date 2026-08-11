import { 
  PrismaClient, 
  Rol, 
  Estatus, 
  Prioridad, 
  EstadoTarea, 
  TipoTarea, 
  ClasificacionTarea, 
  TipoEvento
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const CriticidadMaquina = {
  A: 'A',
  B: 'B',
  C: 'C',
} as const;

const EstadoMaquina = {
  OPERATIVA: 'OPERATIVA',
  EN_REPARACION: 'EN_REPARACION',
  INACTIVA: 'INACTIVA',
  BAJA: 'BAJA',
} as const;

const prisma = new PrismaClient();

let DEFAULT_HASH = '';

interface TareaTemplate {
  titulo: string;
  descripcion: string;
  planta: string;
  area: string;
  categoria: string;
  tipo: TipoTarea;
  clasificacion: ClasificacionTarea;
  tiempoEstimado: number;
}

const templates: TareaTemplate[] = [
  {
    titulo: "Asegurar buen funcionamiento de máquinas de bordado y autónomos",
    descripcion: "Revisión diaria y ajuste de tensión en cabezales de máquinas de bordado.",
    planta: "SIGMA",
    area: "LASER Y BORDADO",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 30
  },
  {
    titulo: "Asegurar buen funcionamiento de máquinas de estoperol",
    descripcion: "Inspección de alimentadores automáticos y ajuste de troqueles.",
    planta: "SIGMA",
    area: "PRELIMINARES",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 30
  },
  {
    titulo: "Asegurar buen funcionamiento de máquinas láser y autónomos",
    descripcion: "Limpieza de lentes de enfoque y espejos de desvío en cortadoras láser.",
    planta: "SIGMA",
    area: "LASER Y BORDADO",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 30
  },
  {
    titulo: "Atención a proveedor para reparación de Chiller en máquina Galvo",
    descripcion: "Supervisión técnica de recarga de refrigerante y sellado de tuberías por proveedor externo.",
    planta: "SIGMA",
    area: "LASER",
    categoria: "GESTION",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Cambio de Chillers en máquina Galvo",
    descripcion: "Desconexión de unidad dañada, purgado de mangueras e instalación de nuevo Chiller.",
    planta: "SIGMA",
    area: "LASER",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 60
  },
  {
    titulo: "Corte y pintura de tubería de aire para almacén de mantenimiento",
    descripcion: "Instalación de línea de aire comprimido adicional. Roscado y fijación a muro.",
    planta: "GENERAL",
    area: "TECHO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Instalación eléctrica adicional en taller de mantenimiento",
    descripcion: "Canalización, cableado y colocación de contactos trifásicos para equipos de taller.",
    planta: "KAPPA",
    area: "TALLER MTTO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Revisión de pantalla táctil en máquina de bordado 6",
    descripcion: "Diagnóstico de falla táctil y calibración de panel HMI.",
    planta: "SIGMA",
    area: "LASER Y BORDADO",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 60
  },
  {
    titulo: "Inspección de subestación y termografía de tableros",
    descripcion: "Medición de temperatura con cámara termográfica en interruptores principales.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 90
  },
  {
    titulo: "Lubricación de guías en cortadora hidráulica Atom",
    descripcion: "Limpieza y lubricación periódica de columnas de prensa de corte.",
    planta: "KAPPA",
    area: "CORTE",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 45
  },
  {
    titulo: "Reparación de fuga de aire en pulmón de compresor 2",
    descripcion: "Cambio de empaque en brida de salida y sellado con teflón de alta densidad.",
    planta: "KAPPA",
    area: "TALLER MTTO",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.EXTRAORDINARIA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 75
  },
  {
    titulo: "Reemplazo de luminarias en pasillo de producción Kappa",
    descripcion: "Sustitución de tomacorrientes y tubos de iluminación dañados.",
    planta: "KAPPA",
    area: "PESPUNTE",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Revisión de sistema contra incendios y presión de hidrantes",
    descripcion: "Prueba de arranque de bomba jockey y verificación de presiones en manómetros.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "EQUIPO/MATERIAL",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Cambio de aceite y filtros en bomba de vacío",
    descripcion: "Mantenimiento preventivo anual. Cambio de cartucho separador y aceite sintético.",
    planta: "KAPPA",
    area: "PRELIMINARES",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 90
  },
  {
    titulo: "Pintura y delimitación de cajones en estacionamiento",
    descripcion: "Aplicación de pintura de tráfico amarillo y azul para cajones preferenciales.",
    planta: "GENERAL",
    area: "ESTACIONAMIENTO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 180
  },
  {
    titulo: "Reparación urgente de extractor de polvos en área de corte",
    descripcion: "Falla en motor de extractor. Desmontaje, cambio de baleros y reinstalación.",
    planta: "KAPPA",
    area: "CORTE",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.EXTRAORDINARIA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 150
  },
  {
    titulo: "Auditoría de herramientas y orden en taller",
    descripcion: "Revisión de inventario de cajas de herramientas asignadas y orden general 5S.",
    planta: "KAPPA",
    area: "TALLER MTTO",
    categoria: "GESTION",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 60
  },
  {
    titulo: "Revisión de bandas tensoras en máquinas de coser",
    descripcion: "Ajuste de tensión e inspección de desgaste en poleas de máquinas de costura.",
    planta: "KAPPA",
    area: "PESPUNTE",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 90
  },
  {
    titulo: "Limpieza profunda de serpentín en Chiller central",
    descripcion: "Lavado a presión del serpentín condensador con desincrustante biodegradable.",
    planta: "GENERAL",
    area: "TECHO",
    categoria: "MAQUINARIA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Reparación de cortina metálica de acceso a almacén",
    descripcion: "Alineación de guías laterales y engrase de resorte tensor del portón principal.",
    planta: "KAPPA",
    area: "ALMACEN DE MATERIA PRIMA",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.EXTRAORDINARIA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 90
  },
  {
    titulo: "Calibración de reguladores de presión de gas en comedor",
    descripcion: "Inspección de tuberías y calibración de flujos de gas licuado para cocina.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 60
  },
  {
    titulo: "Instalación de soportes para tubería de agua en patio",
    descripcion: "Anclaje de abrazaderas tipo u en muro perimetral para fijar línea de agua fría.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 120
  },
  {
    titulo: "Revisión de sensores de presencia en puertas automáticas",
    descripcion: "Calibración de rango de detección de fotoceldas en accesos de oficinas.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "EQUIPO/MATERIAL",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.PREVENTIVO,
    tiempoEstimado: 45
  },
  {
    titulo: "Reparación de fuga en cisterna de agua potable",
    descripcion: "Aplicación de sellador impermeabilizante en fisuras internas de pared de concreto.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.EXTRAORDINARIA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 180
  },
  {
    titulo: "Cambio de contactos eléctricos dañados en oficinas",
    descripcion: "Sustitución de tomacorrientes quemados y reapriete de bornes de conexión.",
    planta: "GENERAL",
    area: "PATIO",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.PLANEADA,
    clasificacion: ClasificacionTarea.CORRECTIVO,
    tiempoEstimado: 60
  }
];

const randomEl = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;

const addMinutes = (date: Date, minutes: number): Date => new Date(date.getTime() + minutes * 60000);
const addHours = (date: Date, hours: number): Date => new Date(date.getTime() + hours * 3600000);

const assertSeedSeguro = () => {
  const databaseUrl = process.env.DATABASE_URL || "";
  const nodeEnv = process.env.NODE_ENV || "development";

  if (nodeEnv === "production") {
    throw new Error("ABORTANDO SEED: NODE_ENV=production no puede ejecutar limpieza destructiva.");
  }

  if (!/localhost|127\.0\.0\.1|_test|_dev/i.test(databaseUrl)) {
    throw new Error("ABORTANDO SEED: DATABASE_URL no parece ser una base local/dev/test segura.");
  }
};

async function main() {
  assertSeedSeguro();
  console.log("🚀 Iniciando limpieza de base de datos...");
  DEFAULT_HASH = await bcrypt.hash("123456", 10);

  // Limpieza en orden respetando FKs
  await prisma.intervaloTiempo.deleteMany({});
  await prisma.imagen.deleteMany({});
  await prisma.historialTarea.deleteMany({});
  await prisma.notificacion.deleteMany({});
  await prisma.notificacionLog.deleteMany({});
  await prisma.pushSubscription.deleteMany({});
  await prisma.passwordResetToken.deleteMany({});
  await prisma.bitacora.deleteMany({});
  await prisma.tarea.deleteMany({});
  await prisma.usuario.deleteMany({});
  await prisma.departamento.deleteMany({});

  // Actualizar la contraseña del SUPER_ADMIN principal a "123456"
  await prisma.usuario.updateMany({
    where: { username: "SUPER_ADMIN" },
    data: { password: DEFAULT_HASH }
  });

  console.log("🧹 Base de datos limpia. Creando departamentos básicos...");

  // 1. Departamentos
  const deptoNames = [
    'Mantenimiento',
    'Procesos Tecnológicos',
    'Producción Kappa',
    'Producción Omega',
    'Sistemas',
    'Recursos Humanos'
  ];

  const deptoMap: Record<string, number> = {};
  for (const nombre of deptoNames) {
    const d = await prisma.departamento.create({
      data: {
        nombre,
        planta: nombre.includes('Omega') ? 'OMEGA' : 'KAPPA',
        tipo: 'OPERATIVO',
        estado: Estatus.ACTIVO
      }
    });
    deptoMap[nombre] = d.id;
  }

  console.log("👥 Creando usuarios de Mantenimiento y Clientes Internos...");

  // 2. Usuarios de Mantenimiento (1 Jefe, 3 Coordinadores, 6 Técnicos) + Super Admins
  const mttoUsersData = [
    // Super Admins
    { nombre: "Administrador del Sistema", username: "SUPER_ADMIN", rol: Rol.SUPER_ADMIN, cargo: "Super Admin", email: "admin@cuadra.com.mx", depto: null },
    { nombre: "Triple H", username: "tripleh", rol: Rol.SUPER_ADMIN, cargo: "Super Admin", email: "tripleh@cuadra.com.mx", depto: null },
    // 1 Jefe
    { nombre: "Shawn Michaels", username: "shawnmichaels", rol: Rol.JEFE_MTTO, cargo: "Jefe de Mantenimiento", email: "shawnmichaels@cuadra.com.mx", depto: "Mantenimiento" },
    // 3 Coordinadores
    { nombre: "The Undertaker", username: "undertaker", rol: Rol.COORDINADOR_MTTO, cargo: "Coordinador de Mecánica", email: "undertaker@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Roman Reigns", username: "romanreigns", rol: Rol.COORDINADOR_MTTO, cargo: "Coordinador Eléctrico", email: "romanreigns@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Brock Lesnar", username: "brocklesnar", rol: Rol.COORDINADOR_MTTO, cargo: "Coordinador de Infraestructura", email: "brocklesnar@cuadra.com.mx", depto: "Mantenimiento" },
    // 6 Técnicos
    { nombre: "Stone Cold Steve Austin", username: "stonecold", rol: Rol.TECNICO, cargo: "Técnico Mecánico", email: "stonecold@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "John Cena", username: "johncena", rol: Rol.TECNICO, cargo: "Técnico de Costura", email: "johncena@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Jeff Hardy", username: "jeffhardy", rol: Rol.TECNICO, cargo: "Técnico General", email: "jeffhardy@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Rey Mysterio", username: "reymysterio", rol: Rol.TECNICO, cargo: "Técnico de Electrónica", email: "reymysterio@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Big Show", username: "bigshow", rol: Rol.TECNICO, cargo: "Técnico de Soldadura", email: "bigshow@cuadra.com.mx", depto: "Mantenimiento" },
    { nombre: "Kurt Angle", username: "kurtangle", rol: Rol.TECNICO, cargo: "Técnico de Neumática", email: "kurtangle@cuadra.com.mx", depto: "Mantenimiento" }
  ];

  const dbMttoUsers = [];
  const mttoDeptoId = deptoMap['Mantenimiento'];

  for (const u of mttoUsersData) {
    const user = await prisma.usuario.create({
      data: {
        nombre: u.nombre,
        username: u.username,
        email: u.email,
        password: DEFAULT_HASH,
        rol: u.rol,
        cargo: u.cargo,
        estado: Estatus.ACTIVO,
        departamentoId: u.depto === "Mantenimiento" ? mttoDeptoId : null
      }
    });
    dbMttoUsers.push(user);
  }

  // 3. 10 Clientes Internos
  const clientUsersData = [
    { nombre: "Randy Orton", username: "randyorton", email: "randyorton@cuadra.com.mx", depto: "Procesos Tecnológicos", cargo: "Líder de Procesos" },
    { nombre: "The Rock", username: "therock", email: "therock@cuadra.com.mx", depto: "Recursos Humanos", cargo: "Coordinador de Selección" },
    { nombre: "Cody Rhodes", username: "codyrhodes", email: "codyrhodes@cuadra.com.mx", depto: "Producción Kappa", cargo: "Supervisor de Línea A" },
    { nombre: "Seth Rollins", username: "sethrollins", email: "sethrollins@cuadra.com.mx", depto: "Producción Omega", cargo: "Supervisor de Acabado" },
    { nombre: "Drew McIntyre", username: "drewmcintyre", email: "drewmcintyre@cuadra.com.mx", depto: "Sistemas", cargo: "Soporte TI" },
    { nombre: "AJ Styles", username: "ajstyles", email: "ajstyles@cuadra.com.mx", depto: "Procesos Tecnológicos", cargo: "Ingeniero de Calidad" },
    { nombre: "CM Punk", username: "cmpunk", email: "cmpunk@cuadra.com.mx", depto: "Recursos Humanos", cargo: "Analista de Clima Laboral" },
    { nombre: "Penta", username: "penta", email: "penta@cuadra.com.mx", depto: "Producción Kappa", cargo: "Jefe de Grupo" },
    { nombre: "Cibernético", username: "cibernetico", email: "cibernetico@cuadra.com.mx", depto: "Producción Omega", cargo: "Jefe de Grupo Omega" },
    { nombre: "Gunther", username: "gunther", email: "gunther@cuadra.com.mx", depto: "Sistemas", cargo: "Administrador SAP" }
  ];

  for (const u of clientUsersData) {
    await prisma.usuario.create({
      data: {
        nombre: u.nombre,
        username: u.username,
        email: u.email,
        password: DEFAULT_HASH,
        rol: Rol.CLIENTE_INTERNO,
        cargo: u.cargo,
        estado: Estatus.ACTIVO,
        departamentoId: deptoMap[u.depto]
      }
    });
  }

  // Separamos jefes, coordinadores y técnicos
  const jefes = dbMttoUsers.filter(u => u.rol === Rol.JEFE_MTTO);
  const coordinadores = dbMttoUsers.filter(u => u.rol === Rol.COORDINADOR_MTTO);
  const tecnicos = dbMttoUsers.filter(u => u.rol === Rol.TECNICO);
  const creadoresMtto = [...jefes, ...coordinadores];

  console.log("📅 Generando simulación de tareas internas (Enero - 8 de Junio de 2026)...");

  // Rango de fechas
  const startSimulation = new Date('2026-01-01T08:00:00Z');
  const endSimulation = new Date('2026-06-08T15:40:00Z');

  let cursor = new Date(startSimulation);
  let totalCreadas = 0;

  while (cursor <= endSimulation) {
    const dayOfWeek = cursor.getDay();
    let numTareas = 0;

    if (dayOfWeek === 0) {
      // Domingo: 5% probabilidad de 1 tarea de emergencia
      if (Math.random() < 0.05) numTareas = 1;
    } else if (dayOfWeek === 6) {
      // Sábado: 30% probabilidad de 1 tarea
      if (Math.random() < 0.30) numTareas = 1;
    } else {
      // Lunes a Viernes: 1 a 3 tareas diarias
      numTareas = randomInt(1, 3);
    }

    for (let i = 0; i < numTareas; i++) {
      const template = randomEl(templates);
      const creador = randomEl(creadoresMtto) as typeof dbMttoUsers[0];
      const numTecnicos = Math.random() > 0.85 ? 2 : 1;
      
      // Mezclamos técnicos y tomamos los necesarios
      const tecsAsignados: typeof tecnicos = [];
      const shuffledTecs = [...tecnicos].sort(() => 0.5 - Math.random());
      for (let tIdx = 0; tIdx < numTecnicos; tIdx++) {
        tecsAsignados.push(shuffledTecs[tIdx]!);
      }

      // Hora aleatoria de creación en el día actual (entre 8:00 y 17:00)
      const tCreacion = new Date(cursor);
      tCreacion.setHours(randomInt(8, 16), randomInt(0, 59), randomInt(0, 59));

      if (tCreacion > endSimulation) break;

      const prioridad = randomEl([Prioridad.BAJA, Prioridad.MEDIA, Prioridad.MEDIA, Prioridad.ALTA, Prioridad.CRITICA]);
      const tiempoEstimado = template.tiempoEstimado;
      
      // Fecha de vencimiento: creación + 4 a 48 horas
      const fechaVencimiento = addHours(tCreacion, randomInt(4, 48));

      // Determinar estado final de la tarea
      let estadoFinal: EstadoTarea = EstadoTarea.CERRADO;

      // Si es antes de Junio, casi todo cerrado
      if (tCreacion < new Date('2026-06-01T00:00:00Z')) {
        const rand = Math.random();
        if (rand < 0.94) {
          estadoFinal = EstadoTarea.CERRADO;
        } else if (rand < 0.97) {
          estadoFinal = EstadoTarea.RESUELTO;
        } else if (rand < 0.99) {
          estadoFinal = EstadoTarea.RECHAZADO;
        } else {
          estadoFinal = EstadoTarea.CANCELADA;
        }
      } else {
        // En Junio: mezcla real de estados activos e inactivos
        const rand = Math.random();
        if (rand < 0.40) {
          estadoFinal = EstadoTarea.CERRADO;
        } else if (rand < 0.60) {
          estadoFinal = EstadoTarea.RESUELTO;
        } else if (rand < 0.75) {
          estadoFinal = EstadoTarea.EN_PROGRESO;
        } else if (rand < 0.90) {
          estadoFinal = EstadoTarea.ASIGNADA;
        } else if (rand < 0.93) {
          estadoFinal = EstadoTarea.PENDIENTE;
        } else if (rand < 0.96) {
          estadoFinal = EstadoTarea.EN_PAUSA;
        } else {
          estadoFinal = EstadoTarea.RECHAZADO;
        }
      }

      // Crear tarea básica
      const isPendiente = estadoFinal === EstadoTarea.PENDIENTE;
      const tecsParaConectar = isPendiente ? [] : tecsAsignados;

      const tarea = await prisma.tarea.create({
        data: {
          titulo: template.titulo,
          descripcion: template.descripcion,
          planta: template.planta,
          area: template.area,
          categoria: template.categoria,
          tipo: template.tipo,
          clasificacion: template.clasificacion,
          prioridad,
          estado: isPendiente ? EstadoTarea.PENDIENTE : (estadoFinal === EstadoTarea.CANCELADA ? EstadoTarea.CANCELADA : EstadoTarea.ASIGNADA),
          tiempoEstimado,
          fechaVencimiento,
          creadorId: creador.id,
          departamentoId: mttoDeptoId,
          createdAt: tCreacion,
          updatedAt: tCreacion,
          responsables: {
            connect: tecsParaConectar.map(t => ({ id: t.id }))
          }
        }
      });

      totalCreadas++;

      // Historial Inicial
      await prisma.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: creador.id,
          tipo: TipoEvento.CREACION,
          estadoNuevo: isPendiente ? EstadoTarea.PENDIENTE : EstadoTarea.ASIGNADA,
          nota: "Orden de mantenimiento generada internamente.",
          createdAt: tCreacion
        }
      });

      let currentCursor = tCreacion;

      // Si no es pendiente ni cancelada, avanza el flujo
      if (estadoFinal !== EstadoTarea.PENDIENTE && estadoFinal !== EstadoTarea.CANCELADA) {
        
        // Evento asignación si comenzó como pendiente en la lógica de logs
        currentCursor = addMinutes(currentCursor, randomInt(5, 20));
        await prisma.historialTarea.create({
          data: {
            tareaId: tarea.id,
            usuarioId: creador.id,
            tipo: TipoEvento.ASIGNACION,
            estadoAnterior: EstadoTarea.PENDIENTE,
            estadoNuevo: EstadoTarea.ASIGNADA,
            nota: `Asignado a técnicos de guardia.`,
            createdAt: currentCursor
          }
        });

        // Flujo si llega a En Progreso
        if (estadoFinal !== EstadoTarea.ASIGNADA) {
          const mainTech = tecsAsignados[0]!;
          currentCursor = addMinutes(currentCursor, randomInt(10, 45));

          await prisma.tarea.update({
            where: { id: tarea.id },
            data: {
              estado: EstadoTarea.EN_PROGRESO,
              fechaInicio: currentCursor,
              updatedAt: currentCursor
            }
          });

          await prisma.historialTarea.create({
            data: {
              tareaId: tarea.id,
              usuarioId: mainTech.id,
              tipo: TipoEvento.CAMBIO_ESTADO,
              estadoAnterior: EstadoTarea.ASIGNADA,
              estadoNuevo: EstadoTarea.EN_PROGRESO,
              nota: "Inicio de actividades y revisión física.",
              createdAt: currentCursor
            }
          });

          let startWorkTime = currentCursor;

          // Simular pausa en el camino
          if (estadoFinal === EstadoTarea.EN_PAUSA) {
            const workDuration = randomInt(20, 60);
            currentCursor = addMinutes(currentCursor, workDuration);

            // Guardar intervalo previo
            await prisma.intervaloTiempo.create({
              data: {
                tareaId: tarea.id,
                usuarioId: mainTech.id,
                estado: EstadoTarea.EN_PROGRESO,
                inicio: startWorkTime,
                fin: currentCursor,
                duracion: workDuration
              }
            });

            await prisma.tarea.update({
              where: { id: tarea.id },
              data: {
                estado: EstadoTarea.EN_PAUSA,
                duracionReal: workDuration,
                updatedAt: currentCursor
              }
            });

            await prisma.historialTarea.create({
              data: {
                tareaId: tarea.id,
                usuarioId: mainTech.id,
                tipo: TipoEvento.CAMBIO_ESTADO,
                estadoAnterior: EstadoTarea.EN_PROGRESO,
                estadoNuevo: EstadoTarea.EN_PAUSA,
                nota: "Se pausa la tarea en espera de refacciones / herramientas adicionales.",
                createdAt: currentCursor
              }
            });

          } else if (estadoFinal === EstadoTarea.EN_PROGRESO) {
            // Sigue en progreso actualmente, creamos intervalo abierto
            await prisma.intervaloTiempo.create({
              data: {
                tareaId: tarea.id,
                usuarioId: mainTech.id,
                estado: EstadoTarea.EN_PROGRESO,
                inicio: startWorkTime,
                fin: null
              }
            });

          } else {
            // Tareas resueltas, cerradas o rechazadas
            // Determinar si se entregó con retraso (20% de probabilidad si ya expiró)
            let isDelayed = Math.random() < 0.20;
            let finalWorkDuration = randomInt(Math.max(15, tiempoEstimado - 30), tiempoEstimado + 60);
            let tResolucion: Date;

            if (isDelayed) {
              tResolucion = addHours(fechaVencimiento, randomInt(1, 28));
              // Si la resolución calculada supera el día límite de hoy, la topamos al momento actual
              if (tResolucion > endSimulation) {
                tResolucion = new Date(endSimulation);
              }
            } else {
              tResolucion = addMinutes(startWorkTime, finalWorkDuration);
              // Validar que no pase de la fecha de vencimiento
              if (tResolucion > fechaVencimiento) {
                tResolucion = new Date(fechaVencimiento.getTime() - randomInt(5, 60) * 60000);
              }
            }

            // Crear el intervalo de tiempo completo
            await prisma.intervaloTiempo.create({
              data: {
                tareaId: tarea.id,
                usuarioId: mainTech.id,
                estado: EstadoTarea.EN_PROGRESO,
                inicio: startWorkTime,
                fin: tResolucion,
                duracion: finalWorkDuration
              }
            });

            await prisma.tarea.update({
              where: { id: tarea.id },
              data: {
                estado: EstadoTarea.RESUELTO,
                duracionReal: finalWorkDuration,
                finalizadoAt: tResolucion,
                updatedAt: tResolucion
              }
            });

            await prisma.historialTarea.create({
              data: {
                tareaId: tarea.id,
                usuarioId: mainTech.id,
                tipo: TipoEvento.CAMBIO_ESTADO,
                estadoAnterior: EstadoTarea.EN_PROGRESO,
                estadoNuevo: EstadoTarea.RESUELTO,
                nota: isDelayed 
                  ? "Se concluye el mantenimiento de forma tardía tras resolver problemas complejos."
                  : "Mantenimiento completado exitosamente. Pruebas mecánicas correctas.",
                createdAt: tResolucion
              }
            });

            // Si es cerrada o rechazada
            if (estadoFinal === EstadoTarea.CERRADO) {
              const tCierre = addMinutes(tResolucion, randomInt(10, 120));
              await prisma.tarea.update({
                where: { id: tarea.id },
                data: {
                  estado: EstadoTarea.CERRADO,
                  updatedAt: tCierre
                }
              });

              await prisma.historialTarea.create({
                data: {
                  tareaId: tarea.id,
                  usuarioId: creador.id,
                  tipo: TipoEvento.CAMBIO_ESTADO,
                  estadoAnterior: EstadoTarea.RESUELTO,
                  estadoNuevo: EstadoTarea.CERRADO,
                  nota: "Validación por supervisión aprobada. Cierre del ticket.",
                  createdAt: tCierre
                }
              });
            } else if (estadoFinal === EstadoTarea.RECHAZADO) {
              const tRechazo = addMinutes(tResolucion, randomInt(15, 90));
              await prisma.tarea.update({
                where: { id: tarea.id },
                data: {
                  estado: EstadoTarea.RECHAZADO,
                  finalizadoAt: null, // se limpia al rechazar
                  updatedAt: tRechazo
                }
              });

              await prisma.historialTarea.create({
                data: {
                  tareaId: tarea.id,
                  usuarioId: creador.id,
                  tipo: TipoEvento.CAMBIO_ESTADO,
                  estadoAnterior: EstadoTarea.RESUELTO,
                  estadoNuevo: EstadoTarea.RECHAZADO,
                  nota: "Rechazado: La calibración de los parámetros no coincide con la ficha técnica. Favor de reevaluar.",
                  createdAt: tRechazo
                }
              });
            }
          }
        }
      } else if (estadoFinal === EstadoTarea.CANCELADA) {
        // Log para tareas canceladas
        const tCancel = addMinutes(tCreacion, randomInt(15, 120));
        await prisma.historialTarea.create({
          data: {
            tareaId: tarea.id,
            usuarioId: creador.id,
            tipo: TipoEvento.CAMBIO_ESTADO,
            estadoAnterior: EstadoTarea.PENDIENTE,
            estadoNuevo: EstadoTarea.CANCELADA,
            nota: "Rutina cancelada por duplicidad o reprogramación externa.",
            createdAt: tCancel
          }
        });
      }
    }

    // Avanzar un día
    cursor.setDate(cursor.getDate() + 1);
  }

  console.log("🚀 Iniciando sembrado del catálogo de máquinas...");
  
  const catalogoMaquinas = [
    { codigo: "MBC0001", nombre: "Cabina Ecológica", proceso: "Cabina Ecologica", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0003", nombre: "Cabina Ecológica", proceso: "Cabina Ecologica", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0004", nombre: "Banco con Brochuelos", proceso: "Banco con Brochuelos", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0005", nombre: "Banco con Brochuelos", proceso: "Banco con Brochuelos", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0006", nombre: "Maquina para pulir", proceso: "Pulir", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0007", nombre: "Maquina para pulir", proceso: "Pulir", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0008", nombre: "Banco de Lijas", proceso: "Banco de Lijas", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0009", nombre: "Banco para acabar Calzado", proceso: "Banco de Lijas", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0010", nombre: "Banco de Lijas", proceso: "Banco de Lijas", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0011", nombre: "Banco de Lijas", proceso: "Banco de Lijas", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0015", nombre: "Flameadora con vapor automática", proceso: "Flameadora Montado", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0018", nombre: "Modificada a cuatro estaciones", proceso: "Conformar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0019", nombre: "Planchar tubo 4 estaciones", proceso: "Conformar Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0020", nombre: "Troquelar", proceso: "Troquelar Acabado Riel", planta: "Planta Baja", area: "Acabado Riel", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0021", nombre: "Maquina para Troquelar", proceso: "Troquelar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0022", nombre: "Maquina de troquelar etiqueta", proceso: "Troquelar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0023", nombre: "Maquina de grabar y timbrar", proceso: "Grabar Billeteras Lambda", planta: "Planta Baja", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0024", nombre: "Troquelar Hidráulica", proceso: "Troquelar Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0025", nombre: "Apomazadora", proceso: "Apomazadora Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0026", nombre: "Maquina para apomazar suela", proceso: "Apomazadora Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0027", nombre: "Pre acabar", proceso: "Preacabar Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0029", nombre: "Desvirar Tacón", proceso: "Desvirar Tacon Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0030", nombre: "Desvirar Tacón", proceso: "Desvirar Tacon Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0032", nombre: "Entaconar automática", proceso: "Entaconar Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0033", nombre: "Entaconar automática", proceso: "Entaconar Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0035", nombre: "Remachar neumática", proceso: "Remachar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0036", nombre: "Remachar neumática", proceso: "Remachar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0037", nombre: "Remachar neumática", proceso: "Remachar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0038", nombre: "Coser Suela Stitcher", proceso: "Coser suela Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0039", nombre: "Coser Suela Stitcher", proceso: "Coser suela Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0041", nombre: "Asentar Suela", proceso: "Asentar Suela Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0043", nombre: "Costear", proceso: "Costear Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0044", nombre: "Coser Welt", proceso: "Coser Suela Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0045", nombre: "Coser Welt", proceso: "Coser Suela Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0046", nombre: "Coser Welt", proceso: "Coser suela Acabado L1", planta: "Planta Baja", area: "Acabado L1", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.A },
    { codigo: "MBC0047", nombre: "Rebatir Talón", proceso: "Rebatir Talon MONTADO", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0048", nombre: "Maquina estabilizadora para humedecer", proceso: "Horno Estabilizador Montado", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0049", nombre: "Horno de secado", proceso: "Horno de secado Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0050", nombre: "Secador Activador", proceso: "Secador Activador Acabado L2", planta: "Planta Baja", area: "Acabado L2", ubicacionDetalle: "Planta Baja ACABADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0051", nombre: "Horno de secado", proceso: "Horno de secado Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0052", nombre: "Prensar Tacón", proceso: "Prensar tacon Avios", planta: "Planta Baja", area: "Avios", ubicacionDetalle: "Planta Baja AVIOS", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0053", nombre: "Clavadora para fijar Planta", proceso: "Clavadora Montado", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0054", nombre: "Maquina engrapadora neumatica", proceso: "Engrapadora Neumatica Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0056", nombre: "Maquina Calcera Montar Talón", proceso: "Montar Talon Montado", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0057", nombre: "Maq. de montar lados", proceso: "Montar Enfranques Montado", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0058", nombre: "Montar Puntas", proceso: "Montar puntas Montado", planta: "Planta Baja", area: "Montado", ubicacionDetalle: "Planta Baja MONTADO", criticidad: CriticidadMaquina.B },
    { codigo: "MBC0060", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0063", nombre: "Pesp. Cerrar", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0069", nombre: "Pesp. Plana 1 aguja", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0072", nombre: "Costura recta c/palanca de retroceso", proceso: "Pespuntar Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0077", nombre: "Pesp. Plana 1 aguja", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0078", nombre: "Plana 2 agujas", proceso: "Pespuntar Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0079", nombre: "Maquina de Pespuntar", proceso: "Pespuntar Chamarras", planta: "Planta Baja", area: "Chamarras", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0080", nombre: "Pesp. Zic Zac", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0081", nombre: "Pesp. Zic Zac", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0082", nombre: "Pesp. Zic Zac", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0084", nombre: "Pesp. Zic Zac", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0085", nombre: "Pesp. Zic Zac", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0091", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Cinturones", planta: "Planta Baja", area: "Cinturones", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0092", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Billeteras Lambda", planta: "Planta Baja", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0093", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0101", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0103", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Billeteras Lambda", planta: "Planta Baja", area: "Billeteras Lambda", ubicacionDetalle: "Planta Baja Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0104", nombre: "Pesp. Poste automática 1 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0105", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0107", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0108", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "DESUSO", ubicacionDetalle: "Planta Alta DESUSO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0109", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar PESPUNTE", planta: "Planta Alta", area: "DESUSO", ubicacionDetalle: "Planta Alta DESUSO", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0110", nombre: "Pesp. Poste automática 2 agujas", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0111", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0112", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0113", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0114", nombre: "Pesp. Poste automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0115", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0116", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0117", nombre: "Pesp. Poste automática 2 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0121", nombre: "Pesp. Sobre costura poste giratorio", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0122", nombre: "Pesp. Sobre costura poste giratorio", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0124", nombre: "Costura recta c/corte de hilo", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0126", nombre: "Costura recta c/corte de hilo", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0127", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0128", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0129", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0131", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Chamarras", planta: "Planta Alta", area: "Chamarras", ubicacionDetalle: "Planta Alta Mezannine ACC", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0132", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0133", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0136", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0137", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0138", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Pespunte", planta: "Planta Alta", area: "Pespunte", ubicacionDetalle: "Planta Alta Mezannine PESPUNTE PRELIMINARES", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0139", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
    { codigo: "MBC0140", nombre: "Pesp. Plana automática 1 aguja", proceso: "Pespuntar Lambda", planta: "Planta Baja", area: "Accesorios Lambda", ubicacionDetalle: "Accesorios Lambda", criticidad: CriticidadMaquina.C },
  ];

  for (const item of catalogoMaquinas) {
    let deptoId = mttoDeptoId;
    if (item.area.includes("Pespunte") || item.area.includes("Acabado") || item.area.includes("Montado")) {
      deptoId = deptoMap["Producción Kappa"];
    }

    let plantName = "KAPPA";
    const areaUpper = item.area.toUpperCase();
    const processUpper = item.proceso.toUpperCase();
    const detailUpper = item.ubicacionDetalle.toUpperCase();
    if (areaUpper.includes("PT") || detailUpper.includes("OMEGA") || item.area === "PT OMEGA") {
      plantName = "OMEGA";
    } else if (areaUpper.includes("SIGMA") || areaUpper.includes("LASER") || processUpper.includes("LASER")) {
      plantName = "SIGMA";
    } else if (areaUpper.includes("LAMBDA") || areaUpper.includes("BILLETERAS")) {
      plantName = "LAMBDA";
    } else if (areaUpper.includes("VENTA")) {
      plantName = "VENTA";
    } else if (areaUpper.includes("BAJA")) {
      plantName = "BAJA";
    } else if (areaUpper.includes("SERVICIOS") || areaUpper.includes("GENERAL") || detailUpper.includes("SERVICIOS")) {
      plantName = "GENERAL";
    }

    const isBaja = areaUpper.includes("BAJA");
    const estadoFinal = isBaja ? EstadoMaquina.BAJA : EstadoMaquina.OPERATIVA;

    await prisma.maquina.upsert({
      where: { codigo: item.codigo },
      update: {
        nombre: item.nombre,
        proceso: item.proceso,
        planta: plantName,
        area: item.area,
        ubicacionDetalle: item.ubicacionDetalle,
        criticidad: item.criticidad,
        departamentoId: deptoId,
        ...(isBaja ? { estado: EstadoMaquina.BAJA } : {})
      },
      create: {
        codigo: item.codigo,
        nombre: item.nombre,
        proceso: item.proceso,
        planta: plantName,
        area: item.area,
        ubicacionDetalle: item.ubicacionDetalle,
        criticidad: item.criticidad,
        estado: estadoFinal,
        departamentoId: deptoId
      }
    });
  }

  console.log(`✅ Base de datos poblada exitosamente.`);
  console.log(`Total de tareas creadas: ${totalCreadas}`);
  console.log(`- Jefes creados: ${jefes.length}`);
  console.log(`- Coordinadores creados: ${coordinadores.length}`);
  console.log(`- Técnicos creados: ${tecnicos.length}`);
  console.log(`- Clientes creados: ${clientUsersData.length}`);
}

main()
  .catch((e) => {
    console.error("🔥 Error crítico durante el seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
