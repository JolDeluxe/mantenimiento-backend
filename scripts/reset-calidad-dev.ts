import {
  ClasificacionTarea,
  EstadoTarea,
  Estatus,
  PrismaClient,
  Prioridad,
  Rol,
  TipoEvento,
  TipoTarea,
  type Maquina,
  type Usuario,
} from "@prisma/client";

const prisma = new PrismaClient();

const CONFIRM_FLAG = "--confirm";
const TODAY_MX_START = new Date("2026-07-01T06:00:00.000Z");
const TODAY_MX_END = new Date("2026-07-02T05:59:59.999Z");
const START_RANGE = new Date("2026-01-01T14:00:00.000Z");

const ACTIVIDADES_TOTAL = 1000;
const PREVENTIVOS_TOTAL = 50;
const CORRECTIVOS_TOTAL = 150;

let seed = 20260701;

const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

const randInt = (min: number, max: number) =>
  Math.floor(rand() * (max - min + 1)) + min;

const pick = <T>(items: T[]): T => {
  if (items.length === 0) throw new Error("No hay elementos para seleccionar.");
  return items[randInt(0, items.length - 1)]!;
};

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60_000);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60_000);

const randomDateBetween = (start: Date, end: Date) => {
  const value = start.getTime() + rand() * (end.getTime() - start.getTime());
  return new Date(value);
};

const dueToday = () =>
  new Date("2026-07-01T18:00:00.000Z");

const overdueDate = () =>
  randomDateBetween(new Date("2026-01-05T18:00:00.000Z"), new Date("2026-06-30T18:00:00.000Z"));

const futureWithinToday = () =>
  randomDateBetween(new Date("2026-07-01T15:00:00.000Z"), TODAY_MX_END);

type ActorPool = {
  admins: Usuario[];
  tecnicos: Usuario[];
  clientes: Usuario[];
  maquinasA: Maquina[];
  maquinasB: Maquina[];
  maquinasC: Maquina[];
};

type SyntheticTaskInput = {
  titulo: string;
  descripcion: string;
  categoria: string;
  tipo: TipoTarea;
  clasificacion: ClasificacionTarea | null;
  prioridad: Prioridad;
  estadoFinal: EstadoTarea;
  creador: Usuario;
  responsables: Usuario[];
  createdAt: Date;
  fechaVencimiento: Date;
  tiempoEstimado: number;
  maquina?: Maquina | null;
  planta: string;
  area: string;
  resueltaConRetraso?: boolean;
  notaRechazo?: string;
  paroProduccion?: boolean;
};

const actividadTitulos = [
  "Auditoría 5S en taller de mantenimiento",
  "Inspección de luminarias en pasillo operativo",
  "Revisión de extintores y señalética",
  "Ordenamiento de refacciones en almacén",
  "Limpieza técnica de área común",
  "Verificación de presión en red de aire",
  "Atención a solicitud interna de infraestructura",
  "Revisión de puertas y accesos",
  "Ajuste de mobiliario operativo",
  "Validación de condiciones de seguridad",
];

const correctivoTitulos = [
  "Reparación de botonera de paro de emergencia dañada",
  "Reemplazo de rodamientos de motor de tracción",
  "Cambio de contactor quemado en tablero de fuerza",
  "Sustitución de manguera neumática de alimentación",
  "Reparación de módulo HMI con pantalla táctil intermitente",
  "Sellado de fuga de aceite hidráulico en pistón principal",
  "Alineación por láser de poleas y acoplamientos",
  "Sustitución de electroválvula de control de flujo",
  "Cambio de carbones en motor de escobillas",
  "Reparación de servomotor de eje de posicionado",
];

const preventivoTitulos = [
  "Lubricación general de guías y husillos lineales",
  "Limpieza profunda de filtros de aire y rejillas",
  "Revisión de conexiones eléctricas y reapriete de bornes",
  "Calibración de pirómetro y termopar de zona de calentamiento",
  "Ajuste de tensión en rodillos y bandas",
  "Inspección preventiva de sensores de seguridad",
  "Verificación de presión y fugas neumáticas",
  "Cambio preventivo de bandas de transmisión",
];

const actividadCategoria = () =>
  pick(["INFRAESTRUCTURA", "SEGURIDAD", "CALIDAD", "GESTION", "SERVICIOS"]);

const prioridadAleatoria = () =>
  pick([Prioridad.BAJA, Prioridad.MEDIA, Prioridad.MEDIA, Prioridad.ALTA, Prioridad.CRITICA]);

const responsablesAleatorios = (tecnicos: Usuario[]) => {
  const shuffled = [...tecnicos].sort(() => rand() - 0.5);
  return shuffled.slice(0, rand() > 0.82 ? 2 : 1);
};

const maquinaPorCriticidad = (pool: ActorPool, index: number) => {
  const buckets = [pool.maquinasA, pool.maquinasB, pool.maquinasC];
  return pick(buckets[index % buckets.length]!);
};

async function crearTareaSintetica(input: SyntheticTaskInput) {
  const startedAt = addMinutes(input.createdAt, randInt(20, 240));
  const estimated = input.tiempoEstimado;
  const actualDuration = Math.max(15, Math.round(estimated * (0.55 + rand() * 1.75)));

  let fechaInicio: Date | null = null;
  let finalizadoAt: Date | null = null;
  let duracionReal = 0;
  let updatedAt = input.createdAt;

  if (
    input.estadoFinal === EstadoTarea.EN_PROGRESO ||
    input.estadoFinal === EstadoTarea.RESUELTO ||
    input.estadoFinal === EstadoTarea.CERRADO ||
    input.estadoFinal === EstadoTarea.RECHAZADO
  ) {
    fechaInicio = startedAt;
    updatedAt = startedAt;
  }

  if (
    input.estadoFinal === EstadoTarea.RESUELTO ||
    input.estadoFinal === EstadoTarea.CERRADO ||
    input.estadoFinal === EstadoTarea.RECHAZADO
  ) {
    const onTimeFinish = addMinutes(input.fechaVencimiento, -randInt(15, 360));
    const lateFinish = addMinutes(input.fechaVencimiento, randInt(30, 720));
    finalizadoAt = input.resueltaConRetraso ? lateFinish : onTimeFinish;
    if (finalizadoAt < startedAt) finalizadoAt = addMinutes(startedAt, actualDuration);
    duracionReal = actualDuration;
    updatedAt = finalizadoAt;
  }

  if (input.estadoFinal === EstadoTarea.RECHAZADO) {
    finalizadoAt = null;
    updatedAt = addMinutes(input.fechaVencimiento, randInt(60, 360));
  }

  return prisma.$transaction(async (tx) => {
    const tarea = await tx.tarea.create({
      data: {
        titulo: input.titulo,
        descripcion: input.descripcion,
        categoria: input.categoria,
        tipo: input.tipo,
        clasificacion: input.clasificacion,
        prioridad: input.prioridad,
        estado: input.estadoFinal,
        fechaVencimiento: input.fechaVencimiento,
        fechaVencimientoOriginal: input.fechaVencimiento,
        tiempoEstimado: estimated,
        fechaInicio,
        finalizadoAt,
        duracionReal,
        maquinaId: input.maquina?.id ?? null,
        planta: input.planta,
        area: input.area,
        creadorId: input.creador.id,
        departamentoId: input.creador.departamentoId,
        paroProduccion: input.paroProduccion ?? false,
        responsables: {
          connect: input.responsables.map((r) => ({ id: r.id })),
        },
        createdAt: input.createdAt,
        updatedAt,
      },
    });

    await tx.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: input.creador.id,
        tipo: TipoEvento.CREACION,
        estadoNuevo: EstadoTarea.ASIGNADA,
        nota: input.maquina
          ? `Dato sintético: ${input.clasificacion ?? "SIN_CLASIFICACION"} en máquina ${input.maquina.codigo}.`
          : "Dato sintético: actividad interna sin maquinaria.",
        createdAt: input.createdAt,
      },
    });

    if (fechaInicio) {
      await tx.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.responsables[0]!.id,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: EstadoTarea.ASIGNADA,
          estadoNuevo: EstadoTarea.EN_PROGRESO,
          nota: "Inicio de atención sintética.",
          createdAt: fechaInicio,
        },
      });
    }

    if (fechaInicio && input.estadoFinal === EstadoTarea.EN_PROGRESO) {
      await tx.intervaloTiempo.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.responsables[0]!.id,
          estado: EstadoTarea.EN_PROGRESO,
          inicio: fechaInicio,
        },
      });
    }

    if (fechaInicio && duracionReal > 0 && (input.estadoFinal === EstadoTarea.RESUELTO || input.estadoFinal === EstadoTarea.CERRADO || input.estadoFinal === EstadoTarea.RECHAZADO)) {
      const finTrabajo = addMinutes(fechaInicio, duracionReal);
      await tx.intervaloTiempo.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.responsables[0]!.id,
          estado: EstadoTarea.EN_PROGRESO,
          inicio: fechaInicio,
          fin: finTrabajo,
          duracion: duracionReal,
        },
      });

      const resueltoAt = finalizadoAt ?? finTrabajo;
      await tx.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.responsables[0]!.id,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: EstadoTarea.EN_PROGRESO,
          estadoNuevo: EstadoTarea.RESUELTO,
          nota: "Resolución sintética con registro de tiempo.",
          createdAt: resueltoAt,
        },
      });
    }

    if (input.estadoFinal === EstadoTarea.CERRADO) {
      await tx.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.creador.id,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: EstadoTarea.RESUELTO,
          estadoNuevo: EstadoTarea.CERRADO,
          nota: "Cierre validado para set sintético de calidad.",
          createdAt: updatedAt,
        },
      });
    }

    if (input.estadoFinal === EstadoTarea.RECHAZADO) {
      await tx.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: input.creador.id,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: EstadoTarea.RESUELTO,
          estadoNuevo: EstadoTarea.RECHAZADO,
          nota: input.notaRechazo ?? "Rechazo sintético.",
          createdAt: updatedAt,
        },
      });
    }

    return tarea;
  });
}

function buildActividades(pool: ActorPool): SyntheticTaskInput[] {
  const items: SyntheticTaskInput[] = [];

  const pushActividad = (estadoFinal: EstadoTarea, fechaVencimiento: Date, resueltaConRetraso = false) => {
    const creador = pick(pool.admins);
    const createdAt = randomDateBetween(START_RANGE, addDays(fechaVencimiento, -1));
    items.push({
      titulo: pick(actividadTitulos),
      descripcion: "Actividad interna sintética para validar métricas de calidad y cumplimiento.",
      categoria: actividadCategoria(),
      tipo: rand() > 0.78 ? TipoTarea.EXTRAORDINARIA : TipoTarea.PLANEADA,
      clasificacion: null,
      prioridad: prioridadAleatoria(),
      estadoFinal,
      creador,
      responsables: responsablesAleatorios(pool.tecnicos),
      createdAt,
      fechaVencimiento,
      tiempoEstimado: randInt(30, 240),
      planta: pick(["KAPPA", "OMEGA", "SIGMA", "LAMBDA", "GENERAL"]),
      area: pick(["TALLER MTTO", "PATIO", "PESPUNTE", "ACABADO", "SERVICIOS", "ALMACEN"]),
      resueltaConRetraso,
    });
  };

  for (let i = 0; i < 16; i++) pushActividad(EstadoTarea.EN_PROGRESO, dueToday());
  for (let i = 0; i < 4; i++) pushActividad(EstadoTarea.ASIGNADA, dueToday());
  for (let i = 0; i < 16; i++) pushActividad(EstadoTarea.EN_PROGRESO, overdueDate());
  for (let i = 0; i < 4; i++) pushActividad(EstadoTarea.ASIGNADA, overdueDate());
  for (let i = 0; i < 10; i++) pushActividad(EstadoTarea.RESUELTO, randomDateBetween(new Date("2026-01-10T18:00:00.000Z"), new Date("2026-06-25T18:00:00.000Z")), false);
  for (let i = 0; i < 10; i++) pushActividad(EstadoTarea.RESUELTO, randomDateBetween(new Date("2026-01-10T18:00:00.000Z"), new Date("2026-06-25T18:00:00.000Z")), true);
  for (let i = 0; i < 940; i++) {
    pushActividad(
      EstadoTarea.CERRADO,
      randomDateBetween(new Date("2026-01-05T18:00:00.000Z"), new Date("2026-06-28T18:00:00.000Z")),
      i % 4 === 0
    );
  }

  return items.slice(0, ACTIVIDADES_TOTAL);
}

function buildPreventivos(pool: ActorPool): SyntheticTaskInput[] {
  return Array.from({ length: PREVENTIVOS_TOTAL }).map((_, i) => {
    const maquina = maquinaPorCriticidad(pool, i);
    const fechaVencimiento = i < 10
      ? dueToday()
      : randomDateBetween(new Date("2026-01-10T18:00:00.000Z"), new Date("2026-06-28T18:00:00.000Z"));
    return {
      titulo: pick(preventivoTitulos),
      descripcion: `Preventivo sintético para ${maquina.codigo}.`,
      categoria: "MAQUINARIA",
      tipo: TipoTarea.PLANEADA,
      clasificacion: ClasificacionTarea.PREVENTIVO,
      prioridad: prioridadAleatoria(),
      estadoFinal: i < 6 ? EstadoTarea.EN_PROGRESO : i < 10 ? EstadoTarea.ASIGNADA : EstadoTarea.CERRADO,
      creador: pick(pool.admins),
      responsables: responsablesAleatorios(pool.tecnicos),
      createdAt: randomDateBetween(START_RANGE, addDays(fechaVencimiento, -1)),
      fechaVencimiento,
      tiempoEstimado: randInt(45, 180),
      maquina,
      planta: maquina.planta,
      area: maquina.area,
      resueltaConRetraso: i % 5 === 0,
    };
  });
}

function buildCorrectivos(pool: ActorPool): SyntheticTaskInput[] {
  return Array.from({ length: CORRECTIVOS_TOTAL }).map((_, i) => {
    const maquina = maquinaPorCriticidad(pool, i);
    const fechaVencimiento = i < 45
      ? dueToday()
      : i < 70
        ? overdueDate()
        : randomDateBetween(new Date("2026-01-10T18:00:00.000Z"), new Date("2026-06-28T18:00:00.000Z"));
    const estadoFinal = i < 25
      ? EstadoTarea.EN_PROGRESO
      : i < 45
        ? EstadoTarea.ASIGNADA
        : i < 70
          ? EstadoTarea.EN_PROGRESO
          : i < 110
            ? EstadoTarea.RESUELTO
            : EstadoTarea.CERRADO;

    return {
      titulo: pick(correctivoTitulos),
      descripcion: `Reporte correctivo sintético sobre ${maquina.codigo}.`,
      categoria: "MAQUINARIA",
      tipo: TipoTarea.TICKET,
      clasificacion: ClasificacionTarea.CORRECTIVO,
      prioridad: maquina.criticidad === "A" ? Prioridad.CRITICA : maquina.criticidad === "B" ? Prioridad.ALTA : prioridadAleatoria(),
      estadoFinal,
      creador: pick(pool.clientes),
      responsables: responsablesAleatorios(pool.tecnicos),
      createdAt: randomDateBetween(START_RANGE, addDays(fechaVencimiento, -1)),
      fechaVencimiento,
      tiempoEstimado: randInt(30, 240),
      maquina,
      planta: maquina.planta,
      area: maquina.area,
      resueltaConRetraso: i % 3 === 0,
      paroProduccion: i % 7 === 0,
    };
  });
}

function buildRechazadoEspecial(pool: ActorPool): SyntheticTaskInput {
  const creador = pick(pool.clientes);
  const fechaVencimiento = futureWithinToday();
  return {
    titulo: "Fuga de agua",
    descripcion: "Fuga de agua",
    categoria: "INFRAESTRUCTURA",
    tipo: TipoTarea.TICKET,
    clasificacion: null,
    prioridad: Prioridad.ALTA,
    estadoFinal: EstadoTarea.RECHAZADO,
    creador,
    responsables: responsablesAleatorios(pool.tecnicos),
    createdAt: randomDateBetween(START_RANGE, addDays(fechaVencimiento, -1)),
    fechaVencimiento,
    tiempoEstimado: 90,
    maquina: null,
    planta: creador.departamentoId ? "GENERAL" : "KAPPA",
    area: "SERVICIOS",
    notaRechazo: "Sigue la fuga",
  };
}

async function loadPool(): Promise<ActorPool> {
  const [admins, tecnicos, clientes, maquinasA, maquinasB, maquinasC] = await Promise.all([
    prisma.usuario.findMany({
      where: { rol: { in: [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] }, estado: Estatus.ACTIVO },
    }),
    prisma.usuario.findMany({ where: { rol: Rol.TECNICO, estado: Estatus.ACTIVO } }),
    prisma.usuario.findMany({ where: { rol: Rol.CLIENTE_INTERNO, estado: Estatus.ACTIVO } }),
    prisma.maquina.findMany({ where: { criticidad: "A", estado: { notIn: ["BAJA", "BAJA_ERP"] } } }),
    prisma.maquina.findMany({ where: { criticidad: "B", estado: { notIn: ["BAJA", "BAJA_ERP"] } } }),
    prisma.maquina.findMany({ where: { criticidad: "C", estado: { notIn: ["BAJA", "BAJA_ERP"] } } }),
  ]);

  if (admins.length === 0) throw new Error("No hay usuarios admin/jefe/coordinador activos.");
  if (tecnicos.length === 0) throw new Error("No hay técnicos activos.");
  if (clientes.length === 0) throw new Error("No hay clientes internos activos.");
  if (maquinasA.length === 0 || maquinasB.length === 0 || maquinasC.length === 0) {
    throw new Error("Faltan máquinas activas con criticidad A, B o C.");
  }

  return { admins, tecnicos, clientes, maquinasA, maquinasB, maquinasC };
}

async function validate() {
  const [
    totalTareas,
    actividades,
    preventivos,
    correctivos,
    rechazadoFuga,
    rechazados,
    hoyActivas,
    atrasadasActivas,
    resueltas,
    cerradas,
  ] = await Promise.all([
    prisma.tarea.count(),
    prisma.tarea.count({ where: { maquinaId: null, NOT: { titulo: "Fuga de agua" } } }),
    prisma.tarea.count({ where: { tipo: TipoTarea.PLANEADA, clasificacion: ClasificacionTarea.PREVENTIVO, maquinaId: { not: null } } }),
    prisma.tarea.count({ where: { tipo: TipoTarea.TICKET, clasificacion: ClasificacionTarea.CORRECTIVO, maquinaId: { not: null } } }),
    prisma.tarea.count({ where: { titulo: "Fuga de agua", estado: EstadoTarea.RECHAZADO, maquinaId: null } }),
    prisma.tarea.count({ where: { estado: EstadoTarea.RECHAZADO } }),
    prisma.tarea.count({
      where: {
        estado: { in: [EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO] },
        fechaVencimiento: { gte: TODAY_MX_START, lte: TODAY_MX_END },
      },
    }),
    prisma.tarea.count({
      where: {
        estado: { in: [EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO] },
        fechaVencimiento: { lt: TODAY_MX_START },
      },
    }),
    prisma.tarea.count({ where: { estado: EstadoTarea.RESUELTO } }),
    prisma.tarea.count({ where: { estado: EstadoTarea.CERRADO } }),
  ]);

  return {
    totalTareas,
    actividades,
    preventivos,
    correctivos,
    rechazadoFuga,
    rechazados,
    hoyActivas,
    atrasadasActivas,
    resueltas,
    cerradas,
  };
}

async function main() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Operación destructiva detenida. Ejecuta con ${CONFIRM_FLAG}.`);
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Operación bloqueada en NODE_ENV=production.");
  }

  console.log("Cargando actores base...");
  const pool = await loadPool();
  const tareas = [
    ...buildActividades(pool),
    ...buildPreventivos(pool),
    ...buildCorrectivos(pool),
    buildRechazadoEspecial(pool),
  ];

  console.log(`Eliminando tareas existentes (${await prisma.tarea.count()})...`);
  await prisma.tarea.deleteMany({});

  console.log(`Creando ${tareas.length} tareas sintéticas...`);
  for (let i = 0; i < tareas.length; i++) {
    await crearTareaSintetica(tareas[i]!);
    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${tareas.length}`);
    }
  }

  const resumen = await validate();
  console.log("Resumen final:");
  console.log(JSON.stringify(resumen, null, 2));

  if (resumen.actividades !== ACTIVIDADES_TOTAL) {
    throw new Error(`Validación falló: actividades/no máquina esperadas ${ACTIVIDADES_TOTAL}, recibidas ${resumen.actividades}.`);
  }
  if (resumen.preventivos !== PREVENTIVOS_TOTAL) {
    throw new Error(`Validación falló: preventivos esperados ${PREVENTIVOS_TOTAL}, recibidos ${resumen.preventivos}.`);
  }
  if (resumen.correctivos !== CORRECTIVOS_TOTAL) {
    throw new Error(`Validación falló: correctivos esperados ${CORRECTIVOS_TOTAL}, recibidos ${resumen.correctivos}.`);
  }
  if (resumen.rechazadoFuga !== 1 || resumen.rechazados !== 1) {
    throw new Error("Validación falló: debe existir exactamente un ticket rechazado, Fuga de agua.");
  }
}

main()
  .catch((error) => {
    console.error("Reset de calidad falló:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
