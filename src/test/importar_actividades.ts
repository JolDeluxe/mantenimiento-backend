import fs from "fs";
import { PrismaClient, EstadoTarea, TipoTarea, Prioridad } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Limpiando actividades previas...");
  const deleted = await prisma.tarea.deleteMany({
    where: { tipo: TipoTarea.EXTRAORDINARIA, estado: EstadoTarea.CERRADO, maquinaId: null }
  });
  console.log(`Actividades previas eliminadas: ${deleted.count}`);

  console.log("Iniciando importación de actividades...");
  
  const tecnicos = await prisma.usuario.findMany({ where: { rol: "TECNICO", estado: "ACTIVO" } });
  if (tecnicos.length === 0) {
    throw new Error("No hay técnicos activos en el sistema para asignar.");
  }
  let indexTecnico = 0;

  const rawData = fs.readFileSync("../actividades2025.csv", "utf-8");
  const lineas = rawData.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  
  // Skip header
  const dataLines = lineas.slice(1);
  let creadas = 0;

  for (const linea of dataLines) {
    const cols = linea.split(",");
    if (cols.length < 3) continue;

    const fechaStr = cols[0]; // e.g. 25/11/2025
    const area = cols[1];
    const titulo = cols[2];
    const tipo = cols[3] || "EXTRAORDINARIA"; // EXTRAORDINARIA
    const tiempoEstimadoStr = cols[4];
    const duracionRealStr = cols[5];

    let fechaAt = new Date();
    if (fechaStr && fechaStr.includes("/")) {
      const [dia, mes, anio] = fechaStr.split("/");
      // 12:00 UTC to fall cleanly in MX
      fechaAt = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia), 12, 0, 0));
    }

    const tecnico = tecnicos[indexTecnico % tecnicos.length];
    indexTecnico++;

    const minutosReales = duracionRealStr ? parseInt(duracionRealStr) : null;
    const tiempoEstimado = tiempoEstimadoStr ? parseInt(tiempoEstimadoStr) : null;

    await prisma.tarea.create({
      data: {
        tipo: TipoTarea.EXTRAORDINARIA,
        estado: EstadoTarea.CERRADO,
        titulo: titulo,
        descripcion: "",
        area: area || "Desconocida",
        planta: "Desconocida",
        prioridad: Prioridad.MEDIA,
        creadorId: tecnico.id, // Or an admin, using the technician for simplicity
        responsables: { connect: [{ id: tecnico.id }] },
        createdAt: fechaAt,
        fechaVencimiento: fechaAt,
        finalizadoAt: fechaAt,
        duracionReal: minutosReales,
        tiempoEstimado: tiempoEstimado,
      },
    });

    creadas++;
  }

  console.log(`Proceso completado. Actividades importadas y cerradas: ${creadas}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
