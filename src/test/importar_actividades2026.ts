import fs from "fs";
import { PrismaClient, EstadoTarea, TipoTarea, Prioridad } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Iniciando importación de actividades 2026...");
  
  const tecnicos = await prisma.usuario.findMany({ where: { rol: "TECNICO", estado: "ACTIVO" } });
  if (tecnicos.length === 0) {
    throw new Error("No hay técnicos activos en el sistema para asignar.");
  }
  let indexTecnico = 0;

  const rawData = fs.readFileSync("../actividades2026.csv", "utf-8");
  const lineas = rawData.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  
  // Skip header
  const dataLines = lineas.slice(1);
  let creadas = 0;
  let cerradas = 0;
  let asignadas = 0;

  for (const linea of dataLines) {
    const cols = linea.split(",");
    if (cols.length < 3) continue;

    const fechaStr = cols[0]; // e.g. 18/07/2026
    const area = cols[1];
    const titulo = cols[2];
    const tipoStr = (cols[3] || "EXTRAORDINARIA").trim().toUpperCase(); 
    const tiempoEstimadoStr = cols[4];
    const duracionRealStr = cols[5];

    let fechaAt = new Date();
    let estado = EstadoTarea.CERRADO;

    if (fechaStr && fechaStr.includes("/")) {
      const [dia, mes, anio] = fechaStr.split("/");
      // 12:00 UTC to fall cleanly in MX
      fechaAt = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia), 12, 0, 0));
      
      const corte = new Date(Date.UTC(2026, 6, 18, 23, 59, 59));
      if (fechaAt > corte) {
        estado = EstadoTarea.ASIGNADA;
      }
    }

    const tecnico = tecnicos[indexTecnico % tecnicos.length];
    indexTecnico++;

    const valTiempo = duracionRealStr ? parseInt(duracionRealStr) : (tiempoEstimadoStr ? parseInt(tiempoEstimadoStr) : null);
    
    // Si esta asignada, no deberia tener duracion real ni fecha finalizada
    const finalizadoAt = estado === EstadoTarea.CERRADO ? fechaAt : null;
    const duracionReal = estado === EstadoTarea.CERRADO ? valTiempo : null;
    const tiempoEstimado = tiempoEstimadoStr ? parseInt(tiempoEstimadoStr) : null;

    let tipoEnBD = TipoTarea.EXTRAORDINARIA;
    if (tipoStr === "PLANEADA") tipoEnBD = TipoTarea.PLANEADA;
    else if (tipoStr === "TICKET") tipoEnBD = TipoTarea.TICKET;

    await prisma.tarea.create({
      data: {
        tipo: tipoEnBD,
        estado: estado,
        titulo: titulo,
        descripcion: "",
        area: area || "Desconocida",
        planta: "Desconocida",
        prioridad: Prioridad.MEDIA,
        creadorId: tecnico.id, 
        responsables: { connect: [{ id: tecnico.id }] },
        createdAt: fechaAt,
        fechaVencimiento: fechaAt,
        fechaProgramadaPreventiva: fechaAt, // To ensure it shows up in views correctly if it's PLANEADA
        finalizadoAt: finalizadoAt,
        duracionReal: duracionReal,
        tiempoEstimado: tiempoEstimado,
      },
    });

    creadas++;
    if (estado === EstadoTarea.CERRADO) cerradas++;
    else asignadas++;
  }

  console.log(`Proceso completado. Total importadas: ${creadas} (${cerradas} Cerradas, ${asignadas} Asignadas)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
