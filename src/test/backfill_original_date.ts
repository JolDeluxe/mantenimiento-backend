import { prisma } from "../db";

async function main() {
  console.log("Starting backfill for original due date...");
  try {
    const affected = await prisma.$executeRawUnsafe(
      "UPDATE Tarea SET fechaVencimientoOriginal = fechaVencimiento WHERE fechaVencimientoOriginal IS NULL"
    );
    console.log(`Backfill complete. Rows affected: ${affected}`);
  } catch (error) {
    console.error("Error running backfill script:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
