// Ejecutar preview:
// bun src/test/test_ingesta_csv.ts
//
// Aplicar cambios reales:
// bun src/test/test_ingesta_csv.ts --apply
//
// Usar archivo especifico:
// bun src/test/test_ingesta_csv.ts --file="C:/ruta/Maquinaria.csv"

import { prisma } from "../src/db";
import { env } from "../src/env";
import { procesarIngestaMaquinariaCsv } from "../src/utils/maquinaria-csv-ingest";

declare const process: { argv: string[], exit: (code: number) => never };

const args = process.argv.slice(2);
const shouldApply = args.includes("--apply");
const explicitFileArg = args.find((arg: string) => arg.startsWith("--file="));
const previewLimitArg = args.find((arg: string) => arg.startsWith("--preview-limit="));

const filePath = explicitFileArg?.replace("--file=", "").trim() || env.MAQUINARIA_CSV_FILE_PATH;
const previewLimit = Number(previewLimitArg?.replace("--preview-limit=", "") || 30);

procesarIngestaMaquinariaCsv({
  filePath,
  apply: shouldApply,
  previewLimit,
})
  .catch((err) => {
    console.error("Error crítico durante la ingesta ETL:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
