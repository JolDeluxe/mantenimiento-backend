import path from "path";
import { parseHistoricalFile } from "./importaciones/correctivos-historicos/parser";
import { normalizeAndValidateRow } from "./importaciones/correctivos-historicos/normalizer";
import {
  cargarContextoResolucion,
  resolveHistoricalRecord,
} from "./importaciones/correctivos-historicos/resolver";
import { importSingleHistoricalRecord } from "./importaciones/correctivos-historicos/importer";
import { generateHistoricalImportReports } from "./importaciones/correctivos-historicos/report";
import type { ImportOptions, ResolvedHistoricalRecord } from "./importaciones/correctivos-historicos/types";

async function main() {
  const args = process.argv.slice(2);

  const getArgValue = (prefix: string): string | undefined => {
    const found = args.find((a) => a.startsWith(prefix));
    return found ? found.split("=")[1] : undefined;
  };

  const hasFlag = (flag: string): boolean => args.includes(flag);

  const defaultFilePath = path.join(
    process.cwd(),
    "data",
    "imports",
    "correctivos_historicos_2025_2026.tsv"
  );

  const options: ImportOptions = {
    filePath: getArgValue("--file=") || defaultFilePath,
    dryRun: !hasFlag("--apply") || hasFlag("--dry-run"),
    apply: hasFlag("--apply") && !hasFlag("--dry-run"),
    strict: hasFlag("--strict"),
    tecnicoId: getArgValue("--tecnico-id=") ? parseInt(getArgValue("--tecnico-id=")!, 10) : undefined,
    confirmadorId: getArgValue("--confirmador-id=") ? parseInt(getArgValue("--confirmador-id=")!, 10) : undefined,
    batchSize: getArgValue("--batch-size=") ? parseInt(getArgValue("--batch-size=")!, 10) : 50,
    from: getArgValue("--from="),
    to: getArgValue("--to="),
    machineCode: getArgValue("--machine="),
    limit: getArgValue("--limit=") ? parseInt(getArgValue("--limit=")!, 10) : undefined,
  };

  console.log("========================================================================");
  console.log("   IMPORTADOR DE CORRECTIVOS HISTÓRICOS 2025-2026 (SISTEMA CUADRA)    ");
  console.log("========================================================================");
  console.log(`Modo de ejecución: ${options.apply ? "APPLY (Escritura en BD)" : "DRY-RUN (Simulación)"}`);
  console.log(`Archivo fuente:    ${options.filePath}`);

  const databaseUrl = process.env.DATABASE_URL || "";
  const isTestDb = databaseUrl.includes("_test");
  console.log(`Base de datos URL: ${databaseUrl.replace(/:[^:@]+@/, ":****@")}`);
  console.log(`Base de pruebas:   ${isTestDb ? "SÍ (mantenimiento_test)" : "NO"}`);
  console.log("------------------------------------------------------------------------");

  // Guardas de seguridad para la base de datos
  if (options.apply) {
    if (process.env.ALLOW_HISTORICAL_CORRECTIVE_IMPORT !== "true") {
      console.error("ERROR GRAVE: El modo --apply requiere la variable de entorno ALLOW_HISTORICAL_CORRECTIVE_IMPORT=true.");
      console.error("Operación abortada por seguridad.");
      process.exit(1);
    }
  }

  // 1. Parsear archivo fuente
  console.log("1. Leyendo y parseando archivo fuente...");
  const rawRows = parseHistoricalFile(options.filePath);
  console.log(`   Se leyeron ${rawRows.length} filas del archivo.`);

  // 2. Normalizar y validar individualmente
  console.log("2. Normalizando fechas, horas y códigos de máquina...");
  let parsedRecords = rawRows.map(normalizeAndValidateRow);

  // Aplicar filtros opcionales de CLI
  if (options.machineCode) {
    const code = options.machineCode.trim().toUpperCase();
    parsedRecords = parsedRecords.filter((r) => r.codigoMaquinaNorm === code);
  }
  if (options.from) {
    const fromTime = new Date(options.from).getTime();
    parsedRecords = parsedRecords.filter((r) => r.fechaInicio && r.fechaInicio.getTime() >= fromTime);
  }
  if (options.to) {
    const toTime = new Date(options.to).getTime();
    parsedRecords = parsedRecords.filter((r) => r.fechaInicio && r.fechaInicio.getTime() <= toTime);
  }
  if (options.limit && options.limit > 0) {
    parsedRecords = parsedRecords.slice(0, options.limit);
  }

  // 3. Cargar contexto de BD y resolver relaciones
  console.log("3. Resolviendo contra la base de datos (máquinas, clientes, duplicados)...");
  const ctx = await cargarContextoResolucion(options.tecnicoId, options.confirmadorId);
  const fingerprintsEnArchivo = new Set<string>();

  const resolvedRecords: ResolvedHistoricalRecord[] = parsedRecords.map((p) =>
    resolveHistoricalRecord(p, ctx, fingerprintsEnArchivo)
  );

  // Si se especificó --strict y hay errores o máquinas no encontradas, abortar
  const invalidCount = resolvedRecords.filter((r) => !r.isValid || r.action !== "IMPORTAR").length;
  if (options.strict && invalidCount > 0) {
    console.error(`ERROR STRICT: Se encontraron ${invalidCount} filas inválidas u omitidas y la opción --strict está activa.`);
    process.exit(1);
  }

  // 4. Ejecutar importación en modo APPLY si aplica
  let importedCount = 0;
  let failedImportCount = 0;

  if (options.apply) {
    console.log("4. Ejecutando inserciones atómicas en la base de datos...");
    const toImport = resolvedRecords.filter((r) => r.action === "IMPORTAR");

    for (const record of toImport) {
      const res = await importSingleHistoricalRecord(record);
      if (res.success) {
        importedCount++;
      } else {
        failedImportCount++;
        console.error(`   [Error Fila ${record.rowNumber}]: ${res.error}`);
      }
    }
    console.log(`   Inserciones completadas: ${importedCount} exitosas, ${failedImportCount} fallidas.`);
  } else {
    console.log("4. Simulación completada (Dry-Run: Cero escrituras realizadas).");
  }

  // 5. Generar reportes
  console.log("5. Generando reportes de auditoría en carpeta tmp/...");
  const reportResult = generateHistoricalImportReports(resolvedRecords, options);

  console.log("------------------------------------------------------------------------");
  console.log("RESUMEN DE AUDITORÍA HISTÓRICA:");
  console.log(`  - Total filas procesadas:    ${reportResult.summary.totalRows}`);
  console.log(`  - Máquinas encontradas:      ${reportResult.summary.machinesFoundCount}`);
  console.log(`  - Máquinas no encontradas:  ${reportResult.summary.machinesNotFoundCount}`);
  console.log(`  - Filas listísimas a importar: ${reportResult.summary.readyToImportCount}`);
  console.log(`  - Duplicados en archivo:     ${reportResult.summary.duplicateInFileCount}`);
  console.log(`  - Ya importadas en BD:        ${reportResult.summary.alreadyInDbCount}`);
  console.log(`  - Filas en Domingo:          ${reportResult.summary.rowsByDayOfWeek.dom}`);
  console.log(`  - Intervalos Paro creados:   0 (Instrucción explícita)`);
  console.log("------------------------------------------------------------------------");
  console.log(`Reporte JSON: ${reportResult.jsonPath}`);
  console.log(`Reporte CSV:  ${reportResult.csvPath}`);
  console.log("========================================================================");
}

main().catch((err) => {
  console.error("Error fatal en ejecutor del importador:", err);
  process.exit(1);
});
