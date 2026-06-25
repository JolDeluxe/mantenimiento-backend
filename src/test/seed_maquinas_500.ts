import { prisma } from "../db";
import { 
  EstadoTarea, 
  Prioridad, 
  TipoTarea, 
  ClasificacionTarea, 
  Rol,
  TipoEvento
} from "@prisma/client";

const TITULOS_MANTENIMIENTO = [
  "Ajuste de tensión en rodillos y bandas",
  "Cambio de contactor quemado en tablero de fuerza",
  "Limpieza profunda de filtros de aire y rejillas",
  "Calibración fina de sensor de proximidad inductivo",
  "Sustitución de manguera neumática de alimentación",
  "Reparación de servomotor de eje de posicionado",
  "Sellado de fuga de aceite hidráulico en pistón principal",
  "Reemplazo de rodamientos de motor de tracción",
  "Alineación y calibración de cabezal de extrusión",
  "Lubricación general de guías y husillos lineales",
  "Revisión de conexiones eléctricas y reapriete de bornes",
  "Sustitución de electroválvula de control de flujo",
  "Limpieza y purgado de trampa de condensado en compresor",
  "Cambio de carbones en motor de escobillas",
  "Reparación de botonera de paro de emergencia dañada",
  "Calibración de pirómetro y termopar de zona de calentamiento",
  "Reemplazo de bandas de transmisión de poleas",
  "Sustitución de empaques y sellos mecánicos en bomba de agua",
  "Alineación por láser de poleas y acoplamientos",
  "Reparación de módulo HMI con pantalla táctil intermitente"
];

const DESCRIPCIONES = [
  "Se detectó un calentamiento inusual durante la operación normal del equipo.",
  "Mantenimiento correctivo realizado tras reporte de falla en la línea de producción.",
  "Inspección rutinaria que evidenció desgaste prematuro en piezas móviles.",
  "Reparación programada del sistema de fuerza del equipo.",
  "Se realiza el cambio preventivo de refacciones críticas según horas de uso.",
  "Falla mecánica reportada por el operador del turno matutino.",
  "Intervención rápida para restablecer el estado operativo de la máquina.",
  "Ajuste general y lubricación periódica de componentes de transmisión.",
  "Corrección de holgura en el eje para evitar vibraciones en la estructura.",
  "Sustitución de cableado dañado por fricción mecánica."
];

const OBSERVACIONES_TECNICO = [
  "Se completó la reparación satisfactoriamente. El equipo quedó operativo en rango normal.",
  "Mantenimiento concluido. Se realizaron pruebas de vacío y carga sin novedades.",
  "Se cambiaron las refacciones dañadas y se verificaron los niveles de fluidos.",
  "Corrección de falla eléctrica completada. Se aisló la línea afectada.",
  "Se lubricaron las guías y se ajustó la tensión. Operación suave del equipo.",
  "Fuga corregida mediante cambio de empaque de neopreno de alta presión.",
  "Se calibró el sensor y se ajustaron los límites de carrera del pistón.",
  "Se limpiaron los contactos eléctricos y se reapretaron las terminales.",
  "Reparación menor completada en sitio sin necesidad de desmontar.",
  "Mantenimiento concluido. Se recomienda monitorear temperatura en las próximas 48 horas."
];

const PLANTAS = ["KAPPA", "SIGMA", "OMEGA", "LAMBDA"];
const AREAS = [
  "PESPUNTE",
  "CORTE LA SER",
  "LASER Y BORDADO",
  "PRELIMINARES",
  "BOLSAS Y BILLETERAS",
  "TALLER MTTO",
  "NAVE CENTRAL"
];

function getRandomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getRandomEl<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("🚀 Iniciando generación de 500 tareas de mantenimiento...");

  // 1. Obtener recursos de la base de datos
  const maquinas = await prisma.maquina.findMany();
  if (maquinas.length === 0) {
    console.error("❌ ERROR: No hay máquinas registradas en la base de datos. Por favor, corre primero el seed de máquinas.");
    process.exit(1);
  }

  const clientes = await prisma.usuario.findMany({ where: { rol: Rol.CLIENTE_INTERNO } });
  const tecnicos = await prisma.usuario.findMany({ where: { rol: Rol.TECNICO } });
  const admins = await prisma.usuario.findMany({ where: { rol: { in: [Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO] } } });

  if (clientes.length === 0 || tecnicos.length === 0 || admins.length === 0) {
    console.error("❌ ERROR: Faltan roles de usuario requeridos en la base de datos.");
    process.exit(1);
  }

  const deptoMantenimiento = await prisma.departamento.findFirst({
    where: { nombre: { contains: "mantenimiento" } }
  });
  const deptoId = deptoMantenimiento ? deptoMantenimiento.id : null;

  console.log(`🤖 Encontradas ${maquinas.length} máquinas en DB.`);
  console.log(`👥 Usuarios disponibles: ${clientes.length} clientes, ${tecnicos.length} técnicos, ${admins.length} administradores/jefes.`);

  // Rango de fechas: Enero de 2026 hasta Hoy (Junio 2026)
  const fechaInicioEnero = new Date("2026-01-01T00:00:00.000Z");
  const fechaFinHoy = new Date(); // Fecha actual de ejecución

  // Seleccionamos 3 máquinas específicas para cargarlas con > 10 mantenimientos garantizados
  const maquinasCargadas = maquinas.slice(0, Math.min(3, maquinas.length));
  console.log(`📌 Se garantizarán más de 10 tareas para las siguientes máquinas:`);
  maquinasCargadas.forEach(m => console.log(`- ${m.codigo} (${m.nombre})`));

  let tareasCreadasCount = 0;

  // Generación garantizada de 15 tareas para cada una de las máquinas elegidas (total 45 tareas aprox.)
  for (const maq of maquinasCargadas) {
    const totalMaqTasks = 15;
    for (let i = 0; i < totalMaqTasks; i++) {
      await crearTareaAleatoria(maq, fechaInicioEnero, fechaFinHoy, clientes, tecnicos, admins, deptoId);
      tareasCreadasCount++;
    }
  }

  // Generación de las tareas restantes para llegar a 500
  const tareasRestantes = 500 - tareasCreadasCount;
  console.log(`⚙️ Generando las ${tareasRestantes} tareas restantes de forma aleatoria...`);

  for (let i = 0; i < tareasRestantes; i++) {
    const maq = getRandomEl(maquinas);
    await crearTareaAleatoria(maq, fechaInicioEnero, fechaFinHoy, clientes, tecnicos, admins, deptoId);
    tareasCreadasCount++;
    if (tareasCreadasCount % 50 === 0) {
      console.log(`📈 Tareas insertadas: ${tareasCreadasCount} / 500`);
    }
  }

  console.log(`\n✅ ¡Generación exitosa! Se han insertado exactamente ${tareasCreadasCount} tareas asociadas a maquinaria en el rango Ene-Hoy.`);
}

async function crearTareaAleatoria(
  maquina: any,
  fechaInicioRango: Date,
  fechaFinRango: Date,
  clientes: any[],
  tecnicos: any[],
  admins: any[],
  deptoId: number | null
) {
  // Determinar datos aleatorios del ticket
  const tipo = getRandomEl([TipoTarea.TICKET, TipoTarea.PLANEADA, TipoTarea.EXTRAORDINARIA]);
  const clasificacion = getRandomEl([ClasificacionTarea.CORRECTIVO, ClasificacionTarea.PREVENTIVO, ClasificacionTarea.AUTONOMO]);
  const prioridad = getRandomEl([Prioridad.BAJA, Prioridad.MEDIA, Prioridad.ALTA, Prioridad.CRITICA]);
  const estado = getRandomEl([EstadoTarea.PENDIENTE, EstadoTarea.ASIGNADA, EstadoTarea.EN_PROGRESO, EstadoTarea.RESUELTO, EstadoTarea.CERRADO]);

  const titulo = getRandomEl(TITULOS_MANTENIMIENTO);
  const descripcion = getRandomEl(DESCRIPCIONES);
  const categoria = "MAQUINARIA";
  const planta = maquina.planta || getRandomEl(PLANTAS);
  const area = maquina.area || getRandomEl(AREAS);

  // Creador
  const creador = tipo === TipoTarea.TICKET ? getRandomEl(clientes) : getRandomEl(admins);

  // Responsables
  const numResponsables = getRandomEl([1, 2]);
  const asignados = [];
  const copiaTecnicos = [...tecnicos];
  for (let j = 0; j < Math.min(numResponsables, tecnicos.length); j++) {
    const idx = Math.floor(Math.random() * copiaTecnicos.length);
    asignados.push(copiaTecnicos.splice(idx, 1)[0]);
  }

  // Fechas correlacionadas
  const createdAt = getRandomDate(fechaInicioRango, fechaFinRango);
  const fechaVencimiento = new Date(createdAt);
  fechaVencimiento.setDate(fechaVencimiento.getDate() + getRandomEl([1, 2, 3, 5]));

  let fechaInicio: Date | null = null;
  let finalizadoAt: Date | null = null;
  let duracionReal = 0;

  if (estado !== EstadoTarea.PENDIENTE) {
    // fechaInicio ocurrió después de la creación (ej. de 10 mins a 12 horas después)
    fechaInicio = new Date(createdAt.getTime() + (10 * 60 * 1000) + Math.random() * (12 * 60 * 60 * 1000));
  }

  if (estado === EstadoTarea.RESUELTO || estado === EstadoTarea.CERRADO) {
    // finalizadoAt ocurrió de 15 minutos a 4 horas después del inicio
    const duracionMs = (15 * 60 * 1000) + Math.random() * (240 * 60 * 1000);
    finalizadoAt = new Date(fechaInicio!.getTime() + duracionMs);
    duracionReal = Math.round(duracionMs / (60 * 1000));
  }

  // Insertar la Tarea
  const tarea = await prisma.tarea.create({
    data: {
      tipo,
      clasificacion,
      titulo,
      categoria,
      descripcion,
      prioridad,
      planta,
      area,
      estado,
      fechaVencimiento,
      fechaInicio,
      finalizadoAt,
      duracionReal,
      maquinaId: maquina.id,
      creadorId: creador.id,
      departamentoId: deptoId,
      createdAt,
      updatedAt: finalizadoAt || fechaInicio || createdAt,
      responsables: {
        connect: asignados.map(r => ({ id: r.id }))
      }
    }
  });

  // Generar Historial de Estados
  // 1. Evento de Creación
  await prisma.historialTarea.create({
    data: {
      tareaId: tarea.id,
      usuarioId: creador.id,
      tipo: TipoEvento.CREACION,
      estadoAnterior: null,
      estadoNuevo: EstadoTarea.PENDIENTE,
      nota: "Reporte levantado y asociado a la maquinaria.",
      createdAt: createdAt
    }
  });

  // 2. Evento de Asignación / Inicio
  if (estado !== EstadoTarea.PENDIENTE && fechaInicio) {
    const tecAsignado = asignados[0] || creador;
    await prisma.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: admins[0].id,
        tipo: TipoEvento.ASIGNACION,
        estadoAnterior: EstadoTarea.PENDIENTE,
        estadoNuevo: EstadoTarea.ASIGNADA,
        nota: `Tarea asignada al técnico ${tecAsignado.nombre}.`,
        createdAt: new Date(createdAt.getTime() + 1000)
      }
    });

    await prisma.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: tecAsignado.id,
        tipo: TipoEvento.CAMBIO_ESTADO,
        estadoAnterior: EstadoTarea.ASIGNADA,
        estadoNuevo: EstadoTarea.EN_PROGRESO,
        nota: "Iniciando labores de reparación.",
        createdAt: fechaInicio
      }
    });
  }

  // 3. Evento de Cierre / Resolución
  if ((estado === EstadoTarea.RESUELTO || estado === EstadoTarea.CERRADO) && finalizadoAt && fechaInicio) {
    const tecFinalizador = asignados[0] || creador;
    const notaObservaciones = getRandomEl(OBSERVACIONES_TECNICO);
    
    // De forma aleatoria, simulamos que algunas usen tiempo manual (marcador meta) y otras registro ordinario
    const usaTiempoManual = Math.random() < 0.3;
    const notaHistorial = usaTiempoManual 
      ? `${notaObservaciones} ||[META:TIEMPO_MANUAL]||` 
      : notaObservaciones;

    // Historial
    await prisma.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: tecFinalizador.id,
        tipo: TipoEvento.CAMBIO_ESTADO,
        estadoAnterior: EstadoTarea.EN_PROGRESO,
        estadoNuevo: EstadoTarea.RESUELTO,
        nota: notaHistorial,
        createdAt: finalizadoAt
      }
    });

    if (estado === EstadoTarea.CERRADO) {
      await prisma.historialTarea.create({
        data: {
          tareaId: tarea.id,
          usuarioId: admins[0].id,
          tipo: TipoEvento.CAMBIO_ESTADO,
          estadoAnterior: EstadoTarea.RESUELTO,
          estadoNuevo: EstadoTarea.CERRADO,
          nota: "Aprobación de reparación. Cierre técnico de ticket.",
          createdAt: new Date(finalizadoAt.getTime() + 60 * 1000)
        }
      });
    }

    // Intervalo de Tiempo
    await prisma.intervaloTiempo.create({
      data: {
        tareaId: tarea.id,
        usuarioId: tecFinalizador.id,
        estado: EstadoTarea.EN_PROGRESO,
        inicio: fechaInicio,
        fin: finalizadoAt,
        duracion: duracionReal
      }
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
