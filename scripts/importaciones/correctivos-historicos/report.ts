import fs from "fs";
import path from "path";
import type { ResolvedHistoricalRecord, ImportSummary, ImportOptions } from "./types";

export interface ReportGenerationResult {
  jsonPath: string;
  csvPath: string;
  summary: ImportSummary;
}

export function generateHistoricalImportReports(
  records: ResolvedHistoricalRecord[],
  options: ImportOptions
): ReportGenerationResult {
  const outputDir = path.join(process.cwd(), "tmp", "importaciones", "correctivos-historicos");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outputDir, `${timestamp}-resumen.json`);
  const csvPath = path.join(outputDir, `${timestamp}-filas.csv`);

  // Métricas para el resumen
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  const distinctCodes = new Set<string>();
  const machinesFound = new Set<string>();
  const machinesNotFound = new Set<string>();

  let validRowsCount = 0;
  let invalidRowsCount = 0;
  let duplicateInFileCount = 0;
  let alreadyInDbCount = 0;
  let potentialDuplicateCount = 0;
  let readyToImportCount = 0;

  const errorCounts: Record<string, number> = {};
  const clientUsageMap = new Map<number, { username: string; count: number }>();
  let lunVie = 0;
  let sab = 0;
  let dom = 0;

  for (const r of records) {
    if (r.codigoMaquinaNorm) {
      distinctCodes.add(r.codigoMaquinaNorm);
    }

    if (r.maquinaId) {
      machinesFound.add(r.codigoMaquinaNorm);
    } else if (r.errorCode === "MAQUINA_NO_EXISTENTE") {
      machinesNotFound.add(r.codigoMaquinaNorm);
    }

    if (r.fechaInicio) {
      if (!minDate || r.fechaInicio < minDate) minDate = r.fechaInicio;
      if (!maxDate || r.fechaInicio > maxDate) maxDate = r.fechaInicio;

      const dayOfWeek = r.fechaInicio.getDay(); // 0 = Domingo, 6 = Sábado
      if (dayOfWeek === 0) {
        dom++;
      } else if (dayOfWeek === 6) {
        sab++;
      } else {
        lunVie++;
      }
    }

    if (r.action === "IMPORTAR") {
      validRowsCount++;
      readyToImportCount++;
      if (r.clienteInternoId && r.clienteInternoUsername) {
        const curr = clientUsageMap.get(r.clienteInternoId) || { username: r.clienteInternoUsername, count: 0 };
        curr.count++;
        clientUsageMap.set(r.clienteInternoId, curr);
      }
    } else if (r.action === "OMITIR_DUPLICADO_ARCHIVO") {
      duplicateInFileCount++;
      invalidRowsCount++;
    } else if (r.action === "OMITIR_YA_IMPORTADA") {
      alreadyInDbCount++;
      invalidRowsCount++;
    } else {
      invalidRowsCount++;
    }

    if (r.errorCode) {
      errorCounts[r.errorCode] = (errorCounts[r.errorCode] || 0) + 1;
    }
  }

  const clientsUsed = Array.from(clientUsageMap.entries()).map(([id, info]) => ({
    id,
    username: info.username,
    count: info.count,
  }));

  const summary: ImportSummary = {
    totalRows: records.length,
    minDate,
    maxDate,
    distinctCodesInFile: distinctCodes.size,
    machinesFoundCount: machinesFound.size,
    machinesNotFoundCount: machinesNotFound.size,
    validRowsCount,
    invalidRowsCount,
    duplicateInFileCount,
    alreadyInDbCount,
    potentialDuplicateCount,
    readyToImportCount,
    importedTasksCount: options.apply ? readyToImportCount : 0,
    importedFallasCount: options.apply ? readyToImportCount : 0,
    importedIntervalosCount: options.apply ? readyToImportCount : 0,
    importedParosCount: 0, // Siempre 0 por regla de negocio
    clientsUsed,
    rowsByDayOfWeek: { lunVie, sab, dom },
    errorCounts,
  };

  // Escribir JSON
  fs.writeFileSync(jsonPath, JSON.stringify({ metadata: { options, timestamp }, summary }, null, 2), "utf8");

  // Escribir CSV
  const csvHeaders = [
    "rowNumber",
    "fingerprint",
    "fecha",
    "departamentoFuente",
    "lineaFuente",
    "codigoFuente",
    "maquinaId",
    "maquinaCodigo",
    "maquinaNombre",
    "clienteInternoId",
    "clienteInterno",
    "inicio",
    "fin",
    "duracion",
    "estado",
    "accion",
    "motivo",
  ].join(",");

  const csvLines = [csvHeaders];
  for (const r of records) {
    const row = [
      r.rowNumber,
      `"${r.fingerprint}"`,
      `"${r.raw.columna1}"`,
      `"${r.raw.departamento}"`,
      `"${r.raw.linea.replace(/"/g, '""')}"`,
      `"${r.raw.equipo}"`,
      r.maquinaId || "",
      `"${r.maquinaCodigo || ""}"`,
      `"${(r.maquinaNombre || "").replace(/"/g, '""')}"`,
      r.clienteInternoId || "",
      `"${r.clienteInternoUsername || ""}"`,
      `"${r.raw.horaInicio}"`,
      `"${r.raw.horaFin}"`,
      r.duracionMinutos || "",
      r.isValid ? "VALIDO" : "INVALIDO",
      r.action,
      `"${(r.errorDetail || "").replace(/"/g, '""')}"`,
    ].join(",");
    csvLines.push(row);
  }

  fs.writeFileSync(csvPath, csvLines.join("\n"), "utf8");

  return {
    jsonPath,
    csvPath,
    summary,
  };
}
