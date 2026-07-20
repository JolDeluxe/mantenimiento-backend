import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const minMax = await prisma.tarea.aggregate({
        _min: { fechaVencimiento: true },
        _max: { fechaVencimiento: true }
    });
    console.log("MinMax:", minMax);
}

main().catch(console.error).finally(() => prisma.$disconnect());
