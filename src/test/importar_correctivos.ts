import fs from "fs";
import { PrismaClient, EstadoTarea, TipoTarea, ClasificacionTarea, Prioridad } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando importación de correctivos...");
  
  const tecnicos = await prisma.usuario.findMany({ where: { rol: "TECNICO", estado: "ACTIVO" } });
  const clientes = await prisma.usuario.findMany({ where: { rol: "CLIENTE_INTERNO", estado: "ACTIVO" } });
  
  if (tecnicos.length === 0 || clientes.length === 0) {
    throw new Error("No hay técnicos o clientes internos suficientes.");
  }
  
  // Cache maquinas by codigo
  const maquinas = await prisma.maquina.findMany();
  const maquinaMap = new Map();
  for (const m of maquinas) {
    if (m.codigo) {
      maquinaMap.set(m.codigo.trim().toUpperCase(), m);
    }
  }

  let idxTec = 0;
  let idxCli = 0;

  const rawData = fs.readFileSync("../CORRECTIVOS.csv", "utf-8");
  const lineas = rawData.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const dataLines = lineas.slice(1);
  let creadas = 0;
  let noMaquina = 0;

  for (const linea of dataLines) {
    const cols = linea.split(",");
    if (cols.length < 5) continue;

    const [fechaStr, codigoStr, iniStr, finStr, durStr] = cols.map(c => c.trim().replace(/^"|"$/g, ''));
    
    const codigo = codigoStr.toUpperCase();
    const maquina = maquinaMap.get(codigo);
    if (!maquina) {
      // It's possible the codigo doesn't exist, we skip or create without maquina?
      // The user wants to link them, so we just log and create without it, or skip.
      // Better to create without it and put the codigo in the title so it's not lost.
      noMaquina++;
    }

    // Parse date e.g. 07/01/25
    let dia = 1, mes = 1, anio = 2025;
    if (fechaStr.includes("/")) {
      const parts = fechaStr.split("/");
      dia = Number(parts[0]);
      mes = Number(parts[1]);
      anio = Number(parts[2]);
      if (anio < 100) anio += 2000;
    }

    // Parse time 08:00
    let iniH = 12, iniM = 0;
    if (iniStr && iniStr.includes(":")) {
      const parts = iniStr.split(":");
      iniH = Number(parts[0]);
      iniM = Number(parts[1]);
    }
    
    let finH = 12, finM = 0;
    if (finStr && finStr.includes(":")) {
      const parts = finStr.split(":");
      finH = Number(parts[0]);
      finM = Number(parts[1]);
    }

    // Sumar 6 horas para compensar la zona horaria MX a UTC
    const startUTC = new Date(Date.UTC(anio, mes - 1, dia, iniH + 6, iniM, 0));
    const endUTC = new Date(Date.UTC(anio, mes - 1, dia, finH + 6, finM, 0));

    const cliente = clientes[idxCli % clientes.length];
    const tecnico = tecnicos[idxTec % tecnicos.length];
    idxCli++;
    idxTec++;

    const duracionReal = durStr ? parseInt(durStr) : null;
    
    const mId = maquina ? maquina.id : null;
    const mArea = maquina ? maquina.area : "Desconocida";
    const mPlanta = maquina ? maquina.planta : "Desconocida";

    await prisma.tarea.create({
      data: {
        tipo: TipoTarea.TICKET,
        clasificacion: ClasificacionTarea.CORRECTIVO,
        estado: EstadoTarea.CERRADO,
        titulo: `Mantenimiento Correctivo - ${codigo}`,
        descripcion: "",
        area: mArea || "Desconocida",
        planta: mPlanta || "Desconocida",
        prioridad: Prioridad.ALTA, 
        creadorId: cliente.id,
        responsables: { connect: [{ id: tecnico.id }] },
        maquinaId: mId,
        createdAt: startUTC,
        fechaVencimiento: startUTC,
        fechaInicio: startUTC,
        finalizadoAt: endUTC,
        duracionReal: duracionReal,
      },
    });

    creadas++;
  }

  console.log(`Completado. Creadas: ${creadas}, Máquina no encontrada pero importada: ${noMaquina}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
