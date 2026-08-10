export interface RawHistoricalRow {
  columna1: string;          // DD/MM/YY
  departamento: string;      // Departamento histórico
  linea: string;             // Descripción histórica de equipo/línea
  equipo: string;            // Código de máquina (ej. MBC0005)
  horaInicio: string;        // HH:mm
  horaFin: string;           // HH:mm
  tiempoFormato: string;     // Tiempo formato (ej. 0:25:00 o #######)
  semana: string;            // Auxiliar
  mes: string;               // Auxiliar
  trMin: string;             // Auxiliar
  trHora: string;            // Auxiliar
  tiempoReparacion: string;  // Duración total en minutos
  columna2: string;          // Auxiliar
  rowNumber: number;
}

export interface ParsedHistoricalRecord {
  rowNumber: number;
  raw: RawHistoricalRow;
  codigoMaquinaNorm: string;
  fechaInicio: Date | null;
  fechaFin: Date | null;
  duracionMinutos: number | null;
  isValid: boolean;
  errorCode: string | null;
  errorDetail: string | null;
  fingerprint: string;
}

export interface ResolvedHistoricalRecord extends ParsedHistoricalRecord {
  maquinaId: number | null;
  maquinaCodigo: string | null;
  maquinaNombre: string | null;
  clienteInternoId: number | null;
  clienteInternoUsername: string | null;
  tecnicoId: number | null;
  confirmadorId: number | null;
  isDuplicateInFile: boolean;
  isAlreadyInDb: boolean;
  isPotentialDuplicate: boolean;
  action:
    | "IMPORTAR"
    | "OMITIR_INVALIDA"
    | "OMITIR_MAQUINA_INEXISTENTE"
    | "OMITIR_DUPLICADO_ARCHIVO"
    | "OMITIR_YA_IMPORTADA"
    | "REVISAR_DUPLICADO_POTENCIAL";
}

export interface ImportOptions {
  filePath: string;
  dryRun: boolean;
  apply: boolean;
  strict: boolean;
  tecnicoId?: number;
  confirmadorId?: number;
  batchSize: number;
  from?: string;
  to?: string;
  machineCode?: string;
  limit?: number;
}

export interface ImportSummary {
  totalRows: number;
  minDate: Date | null;
  maxDate: Date | null;
  distinctCodesInFile: number;
  machinesFoundCount: number;
  machinesNotFoundCount: number;
  validRowsCount: number;
  invalidRowsCount: number;
  duplicateInFileCount: number;
  alreadyInDbCount: number;
  potentialDuplicateCount: number;
  readyToImportCount: number;
  importedTasksCount: number;
  importedFallasCount: number;
  importedIntervalosCount: number;
  importedParosCount: number; // Siempre 0 por diseño
  clientsUsed: { id: number; username: string; count: number }[];
  rowsByDayOfWeek: { lunVie: number; sab: number; dom: number };
  errorCounts: Record<string, number>;
}
