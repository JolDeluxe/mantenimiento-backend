// src/test/seed_tickets_cliente.ts
import { prisma } from "../db";
import { EstadoTarea, TipoEvento, Prioridad, TipoTarea, ClasificacionTarea } from "@prisma/client";

// --- DICCIONARIOS Y DATOS BASE ---
const PLANTAS = ['KAPPA', 'OMEGA', 'SIGMA', 'LAMBDA'];
const AREAS = ['PT', 'PRELIMINARES', 'LASER Y BORDADO', 'BOLSAS Y BILLETERAS', 'ACABADO', 'ALMACEN DE MATERIA PRIMA', 'ALMACEN DE PIELES', 'BORDADO', 'CELULA DESARROLLO', 'CHAMARRAS', 'CINTOS', 'CORTE', 'LASER', 'PESPUNTE', 'MONTADO'];
const CATEGORIAS = ['MAQUINARIA', 'INFRAESTRUCTURA', 'CARRITOS_RIELES', 'MOBILIARIO', 'SERVICIOS_RUTINAS', 'ADMINISTRATIVO'];

const TITULOS_CLIENTE = ["Falla grave en motor", "Banda detenida de emergencia", "Fuga masiva de aceite", "Corto circuito en tablero", "Fallo eléctrico en panel central", "Máquina trabada con material", "Riel atascado", "Sensor de paro no responde", "Sobrecalentamiento peligroso de equipo", "Ruptura de faja"];

// IDs extraídos de la lista de usuarios
const ADMINS: number[] = [2, 3, 7, 9, 21, 22]; 
const CLIENTES: number[] = [1, 5, 11]; 
const TECNICOS: number[] = [4, 8, 10, 12, 19, 20, 25, 26, 27, 28]; // Todos los técnicos

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

const seedTicketsCliente = async () => {
  console.log("🌱 Iniciando seed de TICKETS (100% Clientes). Simulando alta tasa de atrasos y rechazos (Enero-Abril 2026)...");

  // Rango de fechas real
  const fechaInicioGlobal = new Date('2026-01-01T08:00:00Z');
  const fechaFinGlobal = new Date('2026-04-20T17:00:00Z');

  // Generamos 150 tickets puros de cliente
  for (let i = 1; i <= 150; i++) {
    const creadorId = randomEl(CLIENTES);
    
    // Se genera con margen para que tenga tiempo de procesarse (al menos 4 días antes del fin)
    let cursorTiempo = randomDate(fechaInicioGlobal, addHours(fechaFinGlobal, -96));
    const createdAt = new Date(cursorTiempo);
    
    // Configuración estricta 100% Cliente
    const tipo = TipoTarea.TICKET;
    const estadoInicial = EstadoTarea.PENDIENTE;
    const tecnicosAsignados: number[] = [];
    let duracionRealAcumulada = 0;

    const tarea = await prisma.tarea.create({
      data: {
        titulo: `${randomEl(TITULOS_CLIENTE)} - Lote ${randomInt(100,999)}`,
        descripcion: `Reporte de falla crítico #${i}. Generado por cliente en piso.`,
        categoria: randomEl(CATEGORIAS),
        planta: randomEl(PLANTAS),
        area: randomEl(AREAS),
        prioridad: randomEl([Prioridad.ALTA, Prioridad.CRITICA, Prioridad.MEDIA]) as Prioridad,
        tipo,
        clasificacion: randomEl([ClasificacionTarea.CORRECTIVO, ClasificacionTarea.INSPECCION]) as ClasificacionTarea,
        estado: estadoInicial,
        tiempoEstimado: null, // El cliente no sabe cuánto tardará
        fechaVencimiento: null, // Se asignará cuando un admin lo tome
        duracionReal: 0,
        creadorId,
        departamentoId: randomEl([13, 16, 23]), // Departamentos de cliente
        createdAt: cursorTiempo,
        updatedAt: cursorTiempo
      }
    });

    await prisma.historialTarea.create({
      data: {
        tareaId: tarea.id,
        usuarioId: creadorId,
        tipo: TipoEvento.CREACION,
        estadoNuevo: estadoInicial,
        nota: "Falla reportada en piso por cliente interno.",
        createdAt: cursorTiempo
      }
    });

    let estadoActual: EstadoTarea = estadoInicial; 
    
    // 5% de probabilidad de cancelación temprana
    if (Math.random() < 0.05 && cursorTiempo < fechaFinGlobal) {
        cursorTiempo = addMinutes(cursorTiempo, randomInt(15, 120));
        await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: EstadoTarea.CANCELADA, updatedAt: cursorTiempo }});
        await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: creadorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: estadoActual, estadoNuevo: EstadoTarea.CANCELADA, nota: "Se canceló por reporte duplicado.", createdAt: cursorTiempo }});
        continue; 
    }

    // --- FLUJO DE ASIGNACIÓN (SÚPER ATRASADO) ---
    // Simula que el admin tarda mucho en ver el ticket (Entre 1 hora y 2 días)
    cursorTiempo = addMinutes(cursorTiempo, randomInt(60, 2880)); 
    if (cursorTiempo < fechaFinGlobal) {
      // 20% de probabilidad de mandar a 2 técnicos juntos
      const numTecnicos = Math.random() < 0.2 ? 2 : 1;
      while (tecnicosAsignados.length < numTecnicos) {
        const t = randomEl(TECNICOS);
        if (!tecnicosAsignados.includes(t)) tecnicosAsignados.push(t);
      }
      
      estadoActual = EstadoTarea.ASIGNADA;
      
      // Admin asigna una fecha límite agresiva (1 a 3 días) para forzar tickets "Vencidos"
      const fechaVencimiento = addHours(cursorTiempo, randomInt(24, 72));

      await prisma.tarea.update({
        where: { id: tarea.id },
        data: { 
          estado: estadoActual, 
          responsables: { connect: tecnicosAsignados.map(id => ({ id })) }, 
          fechaVencimiento, 
          updatedAt: cursorTiempo 
        }
      });

      await prisma.historialTarea.create({
        data: { tareaId: tarea.id, usuarioId: randomEl(ADMINS), tipo: TipoEvento.ASIGNACION, estadoAnterior: EstadoTarea.PENDIENTE, estadoNuevo: estadoActual, nota: "Técnico(s) asignado(s) a la reparación.", createdAt: cursorTiempo }
      });
    }

    // --- CICLO DE TRABAJO ---
    let tickCount = 0; 
    
    while ((estadoActual as EstadoTarea) !== EstadoTarea.CERRADO && cursorTiempo < fechaFinGlobal && tickCount < 15) {
        tickCount++;
        const eValidado = estadoActual as EstadoTarea;

        if (eValidado === EstadoTarea.ASIGNADA || eValidado === EstadoTarea.EN_PAUSA || eValidado === EstadoTarea.RECHAZADO) {
            // Técnicos tardan mucho en llegar a la máquina (Entre 1 hora y 2 días)
            cursorTiempo = addMinutes(cursorTiempo, randomInt(60, 2880)); 
            if (cursorTiempo > fechaFinGlobal) break;

            const estadoAnterior = estadoActual;
            estadoActual = EstadoTarea.EN_PROGRESO;
            const techId = tecnicosAsignados[0] as number;

            await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, fechaInicio: tarea.fechaInicio || cursorTiempo, updatedAt: cursorTiempo } });
            await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior, estadoNuevo: estadoActual, nota: estadoAnterior === EstadoTarea.RECHAZADO ? "Corrigiendo defectos del rechazo anterior." : "Intervención de mantenimiento en progreso.", createdAt: cursorTiempo } });

            const intervalo = await prisma.intervaloTiempo.create({
                data: { tareaId: tarea.id, usuarioId: techId, inicio: cursorTiempo, estado: EstadoTarea.EN_PROGRESO }
            });

            // Sesión de trabajo larga (45 min a 10 horas)
            const duracionSesion = randomInt(45, 600); 
            cursorTiempo = addMinutes(cursorTiempo, duracionSesion);
            if (cursorTiempo > fechaFinGlobal) cursorTiempo = fechaFinGlobal; 

            const minsReales = Math.floor((cursorTiempo.getTime() - intervalo.inicio.getTime()) / 60000);
            duracionRealAcumulada += minsReales;

            await prisma.intervaloTiempo.update({ where: { id: intervalo.id }, data: { fin: cursorTiempo, duracion: minsReales } });
            await prisma.tarea.update({ where: { id: tarea.id }, data: { duracionReal: duracionRealAcumulada }});

            // 35% de probabilidad de requerir PAUSA
            if (Math.random() < 0.35) { 
                estadoActual = EstadoTarea.EN_PAUSA;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.EN_PROGRESO, estadoNuevo: estadoActual, nota: "Equipo en pausa. Esperando material del almacén general.", createdAt: cursorTiempo } });
                
                // Pausas masivas (De medio día a 5 días)
                cursorTiempo = addHours(cursorTiempo, randomInt(12, 120));
            } else { 
                estadoActual = EstadoTarea.RESUELTO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, finalizadoAt: cursorTiempo, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: techId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.EN_PROGRESO, estadoNuevo: estadoActual, nota: "Reparación concluida en piso. Solicito visto bueno.", createdAt: cursorTiempo } });
            }
        }

        if ((estadoActual as EstadoTarea) === EstadoTarea.RESUELTO) {
            // El cliente tarda en revisar (Entre 1 hora y 3 días)
            cursorTiempo = addMinutes(cursorTiempo, randomInt(60, 4320)); 
            if (cursorTiempo > fechaFinGlobal) break;

            const revisorId = creadorId; // El cliente que lo creó lo cierra

            // 35% DE TASA DE RECHAZO (REQUERIMIENTO)
            if (Math.random() < 0.35) { 
                estadoActual = EstadoTarea.RECHAZADO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, finalizadoAt: null, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: revisorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.RESUELTO, estadoNuevo: estadoActual, nota: "Rechazado en validación. El equipo sigue presentando la falla.", createdAt: cursorTiempo } });
            } else { 
                estadoActual = EstadoTarea.CERRADO;
                await prisma.tarea.update({ where: { id: tarea.id }, data: { estado: estadoActual, updatedAt: cursorTiempo } });
                await prisma.historialTarea.create({ data: { tareaId: tarea.id, usuarioId: revisorId, tipo: TipoEvento.CAMBIO_ESTADO, estadoAnterior: EstadoTarea.RESUELTO, estadoNuevo: estadoActual, nota: "Aprobado. Ticket cerrado y validado.", createdAt: cursorTiempo } });
            }
        }
    }
  }

  console.log("✅ Seed finalizado. 150 Tickets creados con éxito con tasas agresivas de retraso y 35% de rechazo.");
};

seedTicketsCliente()
  .catch((e) => {
    console.error("❌ Error en seed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });