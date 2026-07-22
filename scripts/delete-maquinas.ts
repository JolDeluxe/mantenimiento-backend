import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando proceso de eliminación de máquinas...');

  try {
    // deleteMany() sin condiciones borrará todas las filas de la tabla
    const result = await prisma.maquina.deleteMany({});
    
    console.log(`✅ Proceso completado con éxito. Se eliminaron ${result.count} máquinas.`);
    console.log('Nota: Las reglas recurrentes asociadas fueron eliminadas en cascada.');
    console.log('Nota: Las tareas históricas ahora tienen su maquinaId en null.');
  } catch (error) {
    console.error('❌ Ocurrió un error al intentar eliminar las máquinas:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
