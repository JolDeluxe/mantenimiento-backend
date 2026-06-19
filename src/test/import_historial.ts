// src/test/import_historial.ts
import { prisma } from "../db";
import { EstadoTarea, TipoEvento, TipoTarea, ClasificacionTarea } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

// Tipo de fila que vendrá del Excel exportado a JSON
interface FilaHistorial {
  Fecha: string; // DD/MM/AA
  Departamento: string; // Área física (Cinturones, Lambda, Acabado L1)
  Linea: string; // Proceso (Pespuntar, pulir, etc)
  Equipo: string; // Código de máquina (MBCXXXX)
  HoraInicio: string; // HH:MM
  HoraFin: string; // HH:MM
  TiempoReparacion: number; // Duración en minutos
}

const parseDateString = (fechaStr: string, horaStr: string): Date => {
  // Parsea "09/01/25" e "15:00" en un objeto Date en la zona horaria del sistema
  const [dia = 1, mes = 1, anioShort = 25] = fechaStr.split("/").map(Number);
  const [horas = 0, minutos = 0] = horaStr.split(":").map(Number);
  const anio = 2000 + anioShort;
  
  // Usar constructor local (America/Mexico_City se asume como hora local del servidor)
  return new Date(anio, mes - 1, dia, horas, minutos, 0);
};

const run = async () => {
  const jsonPath = path.join(__dirname, "historial.json");
  
  if (!fs.existsSync(jsonPath)) {
    console.error(`❌ El archivo ${jsonPath} no existe. Por favor colócalo ahí antes de correr el script.`);
    process.exit(1);
  }

  const dataRaw = fs.readFileSync(jsonPath, "utf-8");
  const filas: FilaHistorial[] = JSON.parse(dataRaw);
  
  console.log(`🚀 Iniciando ingesta de ${filas.length} registros históricos del Excel...`);

  // Buscamos un Super Admin o Jefe para asociar como creador por defecto (Shawn Michaels / shawnmichaels)
  const jefeUser = await prisma.usuario.findUnique({
    where: { username: "shawnmichaels" }
  });

  if (!jefeUser) {
    console.error("❌ No se encontró al usuario 'shawnmichaels' (Jefe de Mantenimiento) para asociar el historial.");
    process.exit(1);
  }

  let exitos = 0;
  let fallas = 0;

  for (const fila of filas) {
    try {
      // 1. Encontrar la máquina
      const codigoMaquina = fila.Equipo.toUpperCase().trim();
      const maquina = await prisma.maquina.findUnique({
        where: { codigo: codigoMaquina }
      });

      if (!maquina) {
        console.warn(`⚠️ Máquina no encontrada para código ${codigoMaquina}. Saltando fila.`);
        fallas++;
        continue;
      }

      // 2. Determinar departamento
      let departamentoId = maquina.departamentoId;

      // 3. Formatear fechas
      const fechaInicio = parseDateString(fila.Fecha, fila.HoraInicio);
      const fechaFin = parseDateString(fila.Fecha, fila.HoraFin);

      // 4. Crear tarea
      await prisma.$transaction(async (tx) => {
        const tarea = await tx.tarea.create({
          data: {
            titulo: `Reparación histórica: ${fila.Linea} — ${codigoMaquina}`,
            descripcion: `Registro migrado desde archivo de control Excel histórico. Ubicación: ${fila.Departamento}`,
            planta: maquina.planta,
            area: maquina.area,
            categoria: fila.Linea,
            tipo: TipoTarea.TICKET,
            clasificacion: ClasificacionTarea.CORRECTIVO,
            estado: EstadoTarea.CERRADO,
            duracionReal: fila.TiempoReparacion,
            fechaInicio,
            finalizadoAt: fechaFin,
            creadorId: jefeUser.id,
            departamentoId,
            maquinaId: maquina.id,
            createdAt: fechaInicio,
            updatedAt: fechaFin
          }
        });

        // Crear historial
        await tx.historialTarea.create({
          data: {
            tareaId: tarea.id,
            usuarioId: jefeUser.id,
            tipo: TipoEvento.CREACION,
            estadoNuevo: EstadoTarea.CERRADO,
            nota: "Mantenimiento correctivo migrado exitosamente.",
            createdAt: fechaInicio
          }
        });

        // Crear intervalo pre-cerrado
        await tx.intervaloTiempo.create({
          data: {
            tareaId: tarea.id,
            usuarioId: jefeUser.id,
            estado: EstadoTarea.EN_PROGRESO,
            inicio: fechaInicio,
            fin: fechaFin,
            duracion: fila.TiempoReparacion
          }
        });
      });

      exitos++;
    } catch (err) {
      console.error(`❌ Error importando fila de ${fila.Equipo} el ${fila.Fecha}:`, err);
      fallas++;
    }
  }

  console.log("--------------------------------------------------");
  console.log(`✅ Ingesta finalizada.`);
  console.log(`- Exitosos: ${exitos}`);
  console.log(`- Fallidos/Saltados: ${fallas}`);
};

run()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
