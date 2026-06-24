// Ejecutar con: bun src/test/test_ingesta_csv.ts

import { prisma } from "../db";
import { styleText } from "util";
import fs from "fs";
import readline from "readline";

const CSV_FILE_PATH = "C:/Users/MBCPROEW10028/Downloads/Maquinaria.csv";

// --- HELPERS DE LIMPIEZA ---
function cleanCell(val: string | undefined | null): string {
  if (val === undefined || val === null) return "";
  let cleaned = val.replace(/"/g, ""); // Eliminar comillas dobles
  cleaned = cleaned.replace(/[\r\n]+/g, " "); // Aplastar saltos de línea a espacio
  return cleaned.trim();
}

// --- DETECTOR DE DELIMITADOR ---
async function detectDelimiter(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });

  let firstLine = "";
  for await (const line of rl) {
    firstLine = line;
    break;
  }
  rl.close();
  stream.destroy();

  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  return tabCount > commaCount ? "\t" : ",";
}

// --- PARSER DE LÍNEAS CSV ---
function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// --- DERIVACIÓN DE PLANTA ---
function derivePlanta(ubicacionRaw: string, procesoRaw: string): string {
  const ubicacionUpper = ubicacionRaw.toUpperCase();
  const procesoUpper = procesoRaw.toUpperCase();

  if (ubicacionUpper.includes("OMEGA") || ubicacionUpper.includes("PT OMEGA")) {
    return "OMEGA";
  }
  if (ubicacionUpper.includes("SIGMA") || ubicacionUpper.includes("LASER") || procesoUpper.includes("LASER")) {
    return "SIGMA";
  }
  if (ubicacionUpper.includes("LAMBDA") || ubicacionUpper.includes("BILLETERAS")) {
    return "LAMBDA";
  }
  if (ubicacionUpper.includes("VENTA")) {
    return "VENTA";
  }
  if (ubicacionUpper.includes("BAJA")) {
    return "BAJA";
  }
  if (ubicacionUpper.includes("SERVICIOS") || ubicacionUpper.includes("GENERAL")) {
    return "GENERAL";
  }
  return "KAPPA";
}

// --- DERIVACIÓN DE DEPARTAMENTO ---
function deriveDepartamento(
  planta: string,
  area: string,
  proceso: string,
  deptoMap: Map<string, number>
): number | null {
  const mttoId = deptoMap.get("Mantenimiento") || null;
  const prodKappaId = deptoMap.get("Producción Kappa") || null;
  const prodOmegaId = deptoMap.get("Producción Omega") || null;

  if (planta === "OMEGA") {
    return prodOmegaId;
  }

  const areaUpper = area.toUpperCase();
  const processUpper = proceso.toUpperCase();

  if (
    areaUpper.includes("PESPUNTE") ||
    areaUpper.includes("ACABADO") ||
    areaUpper.includes("MONTADO") ||
    areaUpper.includes("CINTOS") ||
    areaUpper.includes("ADORNO") ||
    areaUpper.includes("AVIOS") ||
    areaUpper.includes("CORTE") ||
    processUpper.includes("PESPUNTE") ||
    processUpper.includes("ACABADO") ||
    processUpper.includes("MONTADO")
  ) {
    return prodKappaId;
  }

  return mttoId;
}

// --- ORQUESTADOR ETL ---
async function runETL() {
  console.log(styleText("blue", "\n=================================================="));
  console.log(styleText("blue", " ⚙️  ETL: INGESTA DE MAQUINARIA DESDE ERP MAGNUS"));
  console.log(styleText("blue", "=================================================="));

  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.error(styleText("red", `\n❌ ERROR: No se encontró el archivo en: ${CSV_FILE_PATH}`));
    process.exit(1);
  }

  console.log(`\n📂 Archivo origen: ${styleText("cyan", CSV_FILE_PATH)}`);
  console.log("⏳ Detectando delimitador del archivo CSV...");
  const delimiter = await detectDelimiter(CSV_FILE_PATH);
  console.log(`📡 Delimitador detectado: [${styleText("yellow", delimiter === "\t" ? "\\t" : delimiter)}]`);

  // 1. Snapshot Inicial de Códigos de Máquinas (Evitar N+1)
  console.log("⚡ Cargando snapshot inicial de maquinaria desde MySQL...");
  const maquinasDb = await prisma.maquina.findMany({
    select: {
      id: true,
      codigo: true,
      estado: true
    }
  });

  const existingMap = new Map<string, { id: number; codigo: string; estado: string }>();
  for (const m of maquinasDb) {
    existingMap.set(m.codigo.toUpperCase().trim(), m);
  }
  console.log(`💾 Snapshot cargado: ${styleText("green", `${existingMap.size} máquinas`)} en base de datos.`);

  // 2. Cargar Departamentos para resolución de IDs
  console.log("🏢 Cargando catálogo de departamentos...");
  const departamentos = await prisma.departamento.findMany({
    select: { id: true, nombre: true }
  });
  const deptoMap = new Map<string, number>();
  for (const d of departamentos) {
    deptoMap.set(d.nombre, d.id);
  }

  // 3. Métricas
  let countNuevas = 0;
  let countActualizadas = 0;
  let countBajaErp = 0;
  let countIgnoradas = 0;
  let countTotalFilas = 0;

  const csvCodesSet = new Set<string>();

  // 4. Iniciar Procesamiento por Flujos / Streams (RAM Segura)
  console.log("🔄 Procesando líneas del archivo...");
  const fileStream = fs.createReadStream(CSV_FILE_PATH);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let isHeader = true;
  let buffer = "";

  for await (const line of rl) {
    countTotalFilas++;

    if (buffer) {
      buffer += "\n" + line;
    } else {
      buffer = line;
    }

    // Contar comillas en el buffer para verificar si la línea está completa
    const quoteCount = (buffer.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      // Falta cerrar alguna comilla, seguimos acumulando líneas en el buffer
      continue;
    }

    const currentLine = buffer;
    buffer = "";

    // Omitir cabecera
    if (isHeader) {
      isHeader = false;
      continue;
    }

    // Saltar líneas totalmente vacías
    if (!currentLine.trim()) {
      countIgnoradas++;
      continue;
    }

    try {
      const row = parseCSVLine(currentLine, delimiter);
      if (row.length < 4) {
        countIgnoradas++;
        continue;
      }

      const rawCode = cleanCell(row[0]);
      const nombre = cleanCell(row[1]);
      const proceso = cleanCell(row[2]);
      const ubicacionRaw = cleanCell(row[3]);

      // Validar código contra formato MBC + 4 dígitos (ej. MBC0018)
      const codeUpper = rawCode.toUpperCase().trim();
      const isValidCode = /^MBC\d{4}$/.test(codeUpper);

      if (!isValidCode) {
        countIgnoradas++;
        continue;
      }

      // Guardar en el set de procesados
      csvCodesSet.add(codeUpper);

      // Derivaciones
      const area = ubicacionRaw.slice(0, 100);
      const planta = derivePlanta(ubicacionRaw, proceso).slice(0, 100);
      const departamentoId = deriveDepartamento(planta, area, proceso, deptoMap);

      const isBaja = ubicacionRaw.toUpperCase().includes("BAJA");
      const estadoFinal = isBaja ? "BAJA" : "OPERATIVA";

      if (existingMap.has(codeUpper)) {
        // --- LEY 2: ACTUALIZACIÓN (Cajones Grises) ---
        const existing = existingMap.get(codeUpper)!;
        
        // Si el equipo estaba marcado como BAJA_ERP pero vuelve a aparecer en el CSV, lo reactivamos.
        // Si la ubicación viene marcada como BAJA, se le asigna el estado BAJA.
        const nuevoEstado = isBaja ? "BAJA" : (existing.estado === "BAJA_ERP" || existing.estado === "BAJA" ? "OPERATIVA" : undefined);

        await prisma.maquina.update({
          where: { id: existing.id },
          data: {
            nombre: nombre.slice(0, 255),
            proceso: proceso.slice(0, 150),
            planta,
            area,
            ubicacionDetalle: ubicacionRaw,
            departamentoId,
            ...(nuevoEstado ? { estado: nuevoEstado } : {})
          }
        });
        countActualizadas++;
      } else {
        // --- LEY 1: ALTA (Cajones Azules e Inicialización) ---
        await prisma.maquina.create({
          data: {
            codigo: codeUpper,
            nombre: nombre.slice(0, 255),
            proceso: proceso.slice(0, 150),
            planta,
            area,
            ubicacionDetalle: ubicacionRaw,
            criticidad: "C",       // Cajón Azul por defecto
            estado: estadoFinal,
            departamentoId
          }
        });
        countNuevas++;
      }

      // Reportar avance periódico
      const totalProcesadas = countNuevas + countActualizadas;
      if (totalProcesadas > 0 && totalProcesadas % 100 === 0) {
        console.log(`   Processed ${styleText("cyan", String(totalProcesadas))} machinery items...`);
      }

    } catch (rowError) {
      console.error(styleText("red", `❌ Error al procesar la línea ${countTotalFilas}:`), rowError);
      countIgnoradas++;
    }
  }

  rl.close();
  fileStream.destroy();

  // --- LEY 3: BAJAS ERP ---
  console.log("🔍 Buscando discrepancias para dar de baja equipos obsoletos en el ERP...");
  for (const [codeUpper, dbMaquina] of existingMap.entries()) {
    if (!csvCodesSet.has(codeUpper)) {
      if (dbMaquina.estado !== "BAJA_ERP") {
        await prisma.maquina.update({
          where: { id: dbMaquina.id },
          data: { estado: "BAJA_ERP" }
        });
        countBajaErp++;
      }
    }
  }

  // --- REPORTE DE RESULTADOS ---
  console.log(styleText("blue", "\n=================================================="));
  console.log(styleText("green", " 🎉 PROCESO ETL COMPLETADO DE FORMA EXITOSA"));
  console.log(styleText("blue", "=================================================="));
  console.log(`📈 Total de líneas en CSV:     ${styleText("cyan", String(countTotalFilas))}`);
  console.log(`🆕 Nuevas registradas (Alta):  ${styleText("green", String(countNuevas))}`);
  console.log(`✏️  Actualizadas (Cajón Gris):  ${styleText("yellow", String(countActualizadas))}`);
  console.log(`⚠️  Dadas de baja (BAJA_ERP):   ${styleText("red", String(countBajaErp))}`);
  console.log(`🚫 Filas ignoradas (Invalid):  ${styleText("magenta", String(countIgnoradas))}`);
  console.log(styleText("blue", "==================================================\n"));
}

// Ejecutar orquestador
runETL()
  .catch((err) => {
    console.error(styleText("red", "🔥 Error crítico durante la ingesta ETL:"), err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
