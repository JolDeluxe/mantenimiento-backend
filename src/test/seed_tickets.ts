// src/test/seed_tickets.ts
import { prisma } from "../db";
import { EstadoTarea, TipoEvento, Prioridad, TipoTarea, ClasificacionTarea } from "@prisma/client";

// --- DICCIONARIOS Y DATOS BASE ---
const PLANTAS = ['KAPPA', 'OMEGA', 'SIGMA', 'LAMBDA'];
const AREAS = ['PT', 'PRELIMINARES', 'LASER Y BORDADO', 'BOLSAS Y BILLETERAS', 'ACABADO', 'ALMACEN DE MATERIA PRIMA', 'ALMACEN DE PIELES', 'BORDADO', 'CELULA DESARROLLO', 'CHAMARRAS', 'CINTOS', 'CORTE', 'LASER', 'PESPUNTE', 'MONTADO'];
const CATEGORIAS = ['MAQUINARIA', 'INFRAESTRUCTURA', 'CARRITOS_RIELES', 'MOBILIARIO', 'SERVICIOS_RUTINAS', 'ADMINISTRATIVO'];

const TITULOS_ADMIN = ["Mantenimiento Preventivo", "Revisión de Rutina", "Inspección de Seguridad", "Calibración de Equipo", "Lubricación General", "Cambio de Refacciones Programado", "Auditoría de Tableros", "Revisión de Compresores", "Mantenimiento a Subestación", "Ajuste de Bandas"];
const TITULOS_CLIENTE = ["Falla en motor", "Banda detenida", "Fuga de aceite", "Lámpara fundida", "Fallo eléctrico en panel", "Máquina hace ruido extraño", "Carrito atorado", "Cable suelto", "Botón de paro no funciona", "Sobrecalentamiento de equipo"];

const ADMINS: number[] = [2, 3, 7, 9, 21, 22]; 
const CLIENTES: number[] = [1, 5, 11]; 
const TECNICOS: number[] = [4, 8, 10, 12, 19, 20, 25, 26, 27, 28]; 

// --- MOTOR DE TIEMPO (OMITE DOMINGOS) ---
const skipSunday = (date: Date): Date => {
  const newDate = new Date(date);
  if (newDate.getDay() === 0) {
    newDate.setDate(newDate.getDate() + 1); // Brincar al lunes
    newDate.setHours(8, 0, 0, 0); // Ajustar a inicio de turno
  }
  return newDate;
};

const randomEl = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)] as T;
const randomInt = (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min;
const addMinutes = (date: Date, minutes: number): Date => skipSunday(new Date(date.getTime() + minutes * 60000));
const addHours = (date: Date, hours: number): Date => skipSunday(new Date(date.getTime() + hours * 3600000));
const randomDate = (start: Date, end: Date): Date => skipSunday(new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime())));

const seedTickets = async () => {
  console.log("🌱 Iniciando distribución aleatoria de tickets Enero-Abril 2026 (Omitiendo Domingos)...");

  // Rango de fechas real
  const fechaInicioGlobal = new Date('2026-01-01T08:00:00Z');
  const fechaFinGlobal = new Date('2026-04-20T17:00:00Z');

  for (let i = 1; i <= 120; i++) {
    const isCliente = i <= 30;
    const creadorId = isCliente ? randomEl(CLIENTES) : randomEl(ADMINS);
    
    // Generación de fecha distribuida aleatoriamente a lo largo de los 4 meses
    let cursorTiempo = randomDate(fechaInicioGlobal, addHours(fechaFinGlobal, -48));
    const createdAt = new Date(cursorTiempo);
    
    const tipo = (isCliente ? TipoTarea.TICKET : randomEl([TipoTarea.PLANEADA, TipoTarea.EXTRAORDINARIA])) as TipoTarea;
    const estadoInicial = (isCliente ? EstadoTarea.PENDIENTE : EstadoTarea.ASIGNADA) as EstadoTarea;
    const tecnicosAsignados: number[] = isCliente ? [] : [randomEl(TECNICOS), randomEl(TECNICOS)].filter((v, idx, a) => a.indexOf(v) === idx);

    let duracionRealAcumulada = 0;

    const tarea = await prisma.tarea.create({
      data: {
        titulo: isCliente ? `${randomEl(TITULOS_CLIENTE)} - Lote ${randomInt(100,999)}` : `${randomEl(TITULOS_ADMIN)} de ${randomEl(AREAS)}`,
        descripcion: `Ticket histórico #${i}. Distribuido aleatoriamente.`,
        categoria: randomEl(CATEGORIAS),
        planta: randomEl(PLANTAS),
        area: randomEl(AREAS),
        prioridad: randomEl(Object.values(Prioridad)) as Prioridad,
        tipo,
        clasificacion: (isCliente ? ClasificacionTarea.CORRECTIVO : randomEl([ClasificacionTarea.PREVENTIVO, ClasificacionTarea.CORRECTIVO, ClasificacionTarea.INSPECCION])) as ClasificacionTarea,
        estado: estadoInicial,
        tiempoEstimado: isCliente ? null : randomInt(60, 600),
        fechaVencimiento: isCliente ? null : addHours(createdAt, randomInt(24, 168)),
        duracionReal: 0,
        creadorId,
        departamentoId: isCliente ? randomEl([13, 16, 23]) : 22,
        createdAt: cursorTiempo,
        updatedAt: cursorTiempo,
        responsables: { connect: tecnicosAsignados.map(id => ({ id })) }
      }
    });

    await prisma.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: creadorId,
        tipo: TipoEvento.CREACION,
        estadoNuevo: estadoInicial,
        nota: "Registro inicial de tarea.",
        createdAt: cursorTiempo
      }
    });

    let estadoActual: EstadoTarea = estadoInicial; 
    
    const pathProbabilidad = Math.random();
    if (pathProbabilidad < 0.05 && cursorTiempo < fechaFinGlobal) {
        cursorTiempo = addMinutes(cursorTiempo, randomInt(15, 120));
        await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: EstadoTarea.CANCELADA, updatedAt: cursorTiempo }});
        await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: creadorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: estadoActual, estadoNuevo: EstadoTarea.CANCELADA, nota: "Se canceló por duplicidad.", createdAt: cursorTiempo }});
        continue; 
    }

    if (isCliente) {
      cursorTiempo = addMinutes(cursorTiempo, randomInt(5, 300)); 
      if (cursorTiempo < fechaFinGlobal) {
        const tecnicoAsignadoId = randomEl(TECNICOS);
        tecnicosAsignados.push(tecnicoAsignadoId);
        estadoActual = EstadoTarea.ASIGNADA;

        await prisma.tarea.update({
          where: { id: tarea.id },
          data: { estado: estadoActual, responsables: { connect: [{ id: tecnicoAsignadoId }] }, fechaVencimiento: addHours(cursorTiempo, randomInt(24, 72)), updatedAt: cursorTiempo }
        });

        await prisma.historialTarea.create({
          data: { tareaId: tarea.id, usuarioId: randomEl(ADMINS), tipo: TipoEvento.ASIGNACION, estadoAnterior: EstadoTarea.PENDIENTE, estadoNuevo: estadoActual, nota: "Técnico asignado.", createdAt: cursorTiempo }
        });
      }
    }

    let tickCount = 0; 
    
    while ((estadoActual as EstadoTarea) !== EstadoTarea.CERRADO && cursorTiempo < fechaFinGlobal && tickCount < 8) {
        tickCount++;
        const eValidado = estadoActual as EstadoTarea;

        if (eValidado === EstadoTarea.ASIGNADA || eValidado === EstadoTarea.EN_PAUSA || eValidado === EstadoTarea.RECHAZADO) {
            cursorTiempo = addMinutes(cursorTiempo, randomInt(15, 240)); 
            if (cursorTiempo > fechaFinGlobal) break;

            const estadoAnterior = estadoActual;
            estadoActual = EstadoTarea.EN_PROGRESO;
            const techId = tecnicosAsignados[0] as number;

            await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, fechaInicio: tarea.fechaInicio || cursorTiempo, updatedAt: cursorTiempo } });
            await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior, estadoNuevo: estadoActual, nota: "Intervención en progreso.", createdAt: cursorTiempo } });

            const intervalo = await prisma.intervaloTiempo.create({
                data: { tareaId: tarea.id, usuarioId: techId, inicio: cursorTiempo, estado: EstadoTarea.EN_PROGRESO }
            });

            const duracionSesion = randomInt(20, 300); 
            cursorTiempo = addMinutes(cursorTiempo, duracionSesion);
            if (cursorTiempo > fechaFinGlobal) cursorTiempo = fechaFinGlobal; 

            const minsReales = Math.floor((cursorTiempo.getTime() - intervalo.inicio.getTime()) / 60000);
            duracionRealAcumulada += minsReales;

            await prisma.intervaloTiempo.update({ where: { id: intervalo.id }, data: { fin: cursorTiempo, duracion: minsReales } });
            await prisma.tarea.update({ where: { id: tarea.id }, data: { duracionReal: duracionRealAcumulada }});

            if (Math.random() < 0.15) { 
                estadoActual = EstadoTarea.EN_PAUSA;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.EN_PROGRESO, estadoNuevo: estadoActual, nota: "En pausa por falta de material.", createdAt: cursorTiempo } });
                cursorTiempo = addHours(cursorTiempo, randomInt(1, 48));
            } else { 
                estadoActual = EstadoTarea.RESUELTO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, finalizadoAt: cursorTiempo, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.EN_PROGRESO, estadoNuevo: estadoActual, nota: "Solucionado en piso.", createdAt: cursorTiempo } });
            }
        }

        if ((estadoActual as EstadoTarea) === EstadoTarea.RESUELTO) {
            cursorTiempo = addMinutes(cursorTiempo, randomInt(30, 2880)); 
            if (cursorTiempo > fechaFinGlobal) break;

            const revisorId = isCliente ? creadorId : randomEl(ADMINS);

            if (Math.random() < 0.35) { 
                estadoActual = EstadoTarea.RECHAZADO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, finalizadoAt: null, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: revisorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.RESUELTO, estadoNuevo: estadoActual, nota: "Rechazado en validación.", createdAt: cursorTiempo } });
            } else { 
                estadoActual = EstadoTarea.CERRADO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: revisorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.RESUELTO, estadoNuevo: estadoActual, nota: "Aprobado. Ticket cerrado.", createdAt: cursorTiempo } });
            }
        }
    }
  }

  console.log("✅ Seed finalizado. Base de datos poblada exitosamente excluyendo domingos.");
};

seedTickets()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });