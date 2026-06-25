import { prisma } from "../db";
import { EstadoTarea } from "@prisma/client";

async function main() {
  console.log("🔄 Iniciando sincronización de fechaUltimoServicio para todas las máquinas...");
  const maquinas = await prisma.maquina.findMany();
  let actualizados = 0;

  for (const maquina of maquinas) {
    const ultimaTarea = await prisma.tarea.findFirst({
      where: {
        maquinaId: maquina.id,
        estado: { in: [EstadoTarea.RESUELTO, EstadoTarea.CERRADO] }
      },
      orderBy: { finalizadoAt: "desc" }
    });

    if (ultimaTarea) {
      const fecha = ultimaTarea.finalizadoAt || ultimaTarea.updatedAt || ultimaTarea.createdAt;
      await prisma.maquina.update({
        where: { id: maquina.id },
        data: { fechaUltimoServicio: fecha }
      });
      actualizados++;
      console.log(`✅ Máquina ${maquina.codigo} sincronizada con fecha: ${fecha.toISOString()}`);
    }
  }

  console.log(`\n🎉 Sincronización completada. Se actualizaron ${actualizados} máquinas.`);
}

main()
  .catch(e => {
    console.error("❌ Error en la sincronización:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
