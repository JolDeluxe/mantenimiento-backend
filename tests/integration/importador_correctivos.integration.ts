import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../../src/db";
import { Rol, Estatus, TipoTarea, ClasificacionTarea, EstadoTarea, CalidadDato, ImpactoProduccionConfirmado, EstadoFalla } from "@prisma/client";
import { parseHistoricalFile } from "../../scripts/importaciones/correctivos-historicos/parser";
import { normalizeAndValidateRow } from "../../scripts/importaciones/correctivos-historicos/normalizer";
import { cargarContextoResolucion, resolveHistoricalRecord } from "../../scripts/importaciones/correctivos-historicos/resolver";
import { importSingleHistoricalRecord } from "../../scripts/importaciones/correctivos-historicos/importer";

// Aislamiento estricto de base de datos de pruebas
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("_test")) {
  console.error("DATABASE_URL DE PRODUCCIÓN/DESARROLLO DETECTADA:", databaseUrl);
  throw new Error("ABORTANDO: Las pruebas de integración deben correr exclusivamente con DATABASE_URL apuntando a mantenimiento_test.");
}

describe("Importador Histórico de Correctivos - Pruebas de Integración (mantenimiento_test)", () => {
  let deptoId: number;
  let clienteUser: any;
  let maquinaValidaId: number;
  const codigoMaquinaValida = "MBC-TEST-IMP-001";

  beforeAll(async () => {
    await prisma.$connect();

    // 1. Crear Departamento
    const depto = await prisma.departamento.create({
      data: {
        nombre: "TEST_IMP_DEPTO_" + Date.now(),
        planta: "Planta Import",
        tipo: "Produccion",
      },
    });
    deptoId = depto.id;

    // 2. Crear Usuario CLIENTE_INTERNO
    clienteUser = await prisma.usuario.create({
      data: {
        username: "cliente_imp_" + Date.now(),
        password: "hashed_password",
        nombre: "Cliente Importador Test",
        rol: Rol.CLIENTE_INTERNO,
        estado: Estatus.ACTIVO,
        departamentoId: deptoId,
      },
    });

    // 3. Crear Máquina para Fixture
    const maquina = await prisma.maquina.create({
      data: {
        codigo: codigoMaquinaValida,
        nombre: "Prensa de Prueba Importador",
        proceso: "Estampado",
        estado: "OPERATIVA",
        planta: "Planta Import",
        area: "Corte",
        criticidad: "A",
      },
    });
    maquinaValidaId = maquina.id;
  });

  afterAll(async () => {
    // Limpieza de datos de prueba
    await prisma.intervaloTiempo.deleteMany({ where: { tarea: { maquinaId: maquinaValidaId } } });
    await prisma.fallaMaquina.deleteMany({ where: { maquinaId: maquinaValidaId } });
    await prisma.tarea.deleteMany({ where: { maquinaId: maquinaValidaId } });
    await prisma.maquina.deleteMany({ where: { id: maquinaValidaId } });
    await prisma.usuario.deleteMany({ where: { id: clienteUser.id } });
    await prisma.departamento.deleteMany({ where: { id: deptoId } });
    await prisma.$disconnect();
  });

  it("A. Debe importar correctamente un correctivo histórico para una máquina existente", async () => {
    const rawRow = {
      columna1: "07/01/25",
      departamento: "Acabado",
      linea: "Laser",
      equipo: codigoMaquinaValida,
      horaInicio: "08:00",
      horaFin: "08:30",
      tiempoFormato: "",
      semana: "",
      mes: "",
      trMin: "",
      trHora: "",
      tiempoReparacion: "30",
      columna2: "",
      rowNumber: 1,
    };

    const parsed = normalizeAndValidateRow(rawRow);
    const ctx = await cargarContextoResolucion();
    const fingerprintsEnArchivo = new Set<string>();
    const resolved = resolveHistoricalRecord(parsed, ctx, fingerprintsEnArchivo);

    expect(resolved.isValid).toBe(true);
    expect(resolved.action).toBe("IMPORTAR");
    expect(resolved.maquinaId).toBe(maquinaValidaId);

    // Importar en BD
    const importRes = await importSingleHistoricalRecord(resolved);
    expect(importRes.success).toBe(true);
    expect(importRes.tareaId).toBeDefined();

    // Verificaciones en Base de Datos
    const tareaDb = await prisma.tarea.findUnique({
      where: { id: importRes.tareaId },
    });
    expect(tareaDb).not.toBeNull();
    expect(tareaDb?.tipo).toBe(TipoTarea.TICKET);
    expect(tareaDb?.clasificacion).toBe(ClasificacionTarea.CORRECTIVO);
    expect(tareaDb?.estado).toBe(EstadoTarea.CERRADO);
    expect(tareaDb?.duracionReal).toBe(30);
    expect(tareaDb?.creadorId).toBe(clienteUser.id);
    expect(tareaDb?.paroProduccion).toBe(false);

    // FallaMaquina creada
    const fallaDb = await prisma.fallaMaquina.findUnique({
      where: { tareaId: importRes.tareaId },
    });
    expect(fallaDb).not.toBeNull();
    expect(fallaDb?.calidadDato).toBe(CalidadDato.HISTORICO_ESTIMADO);
    expect(fallaDb?.impactoConfirmado).toBe(ImpactoProduccionConfirmado.SIN_PARO);
    expect(fallaDb?.estado).toBe(EstadoFalla.CERRADA);
    expect(fallaDb?.contabilizaComoFalla).toBe(true);

    // IntervaloTiempo creado
    const intervaloDb = await prisma.intervaloTiempo.findFirst({
      where: { tareaId: importRes.tareaId },
    });
    expect(intervaloDb).not.toBeNull();
    expect(intervaloDb?.duracion).toBe(30);

    // Confirmar que NO existe IntervaloParoMaquina
    const paroDb = await prisma.intervaloParoMaquina.findFirst({
      where: { tareaId: importRes.tareaId },
    });
    expect(paroDb).toBeNull();
  });

  it("B. Debe rechazar la importación si la máquina no existe en la base de datos", async () => {
    const rawRow = {
      columna1: "07/01/25",
      departamento: "Acabado",
      linea: "Laser",
      equipo: "MBC999999", // No existe
      horaInicio: "08:00",
      horaFin: "08:30",
      tiempoFormato: "",
      semana: "",
      mes: "",
      trMin: "",
      trHora: "",
      tiempoReparacion: "30",
      columna2: "",
      rowNumber: 2,
    };

    const parsed = normalizeAndValidateRow(rawRow);
    const ctx = await cargarContextoResolucion();
    const fingerprintsEnArchivo = new Set<string>();
    const resolved = resolveHistoricalRecord(parsed, ctx, fingerprintsEnArchivo);

    expect(resolved.isValid).toBe(false);
    expect(resolved.action).toBe("OMITIR_MAQUINA_INEXISTENTE");
    expect(resolved.errorCode).toBe("MAQUINA_NO_EXISTENTE");
  });

  it("C. Reejecución idempotente: no debe duplicar registros previamente importados", async () => {
    const rawRow = {
      columna1: "07/01/25",
      departamento: "Acabado",
      linea: "Laser",
      equipo: codigoMaquinaValida,
      horaInicio: "08:00",
      horaFin: "08:30",
      tiempoFormato: "",
      semana: "",
      mes: "",
      trMin: "",
      trHora: "",
      tiempoReparacion: "30",
      columna2: "",
      rowNumber: 1,
    };

    const parsed = normalizeAndValidateRow(rawRow);
    const ctx = await cargarContextoResolucion(); // Carga las tareas que ya tienen el fingerprint en BD
    const fingerprintsEnArchivo = new Set<string>();
    const resolved = resolveHistoricalRecord(parsed, ctx, fingerprintsEnArchivo);

    expect(resolved.isValid).toBe(false);
    expect(resolved.action).toBe("OMITIR_YA_IMPORTADA");
    expect(resolved.errorCode).toBe("YA_IMPORTADO_EN_BASE");
  });

  it("D. Debe permitir registrar correctivos históricos sucedidos en domingo", async () => {
    // 12/01/2025 fue domingo
    const rawRow = {
      columna1: "12/01/25",
      departamento: "Acabado",
      linea: "Laser",
      equipo: codigoMaquinaValida,
      horaInicio: "10:00",
      horaFin: "11:00",
      tiempoFormato: "",
      semana: "",
      mes: "",
      trMin: "",
      trHora: "",
      tiempoReparacion: "60",
      columna2: "",
      rowNumber: 3,
    };

    const parsed = normalizeAndValidateRow(rawRow);
    const ctx = await cargarContextoResolucion();
    const fingerprintsEnArchivo = new Set<string>();
    const resolved = resolveHistoricalRecord(parsed, ctx, fingerprintsEnArchivo);

    expect(resolved.isValid).toBe(true);
    expect(resolved.action).toBe("IMPORTAR");

    const importRes = await importSingleHistoricalRecord(resolved);
    expect(importRes.success).toBe(true);

    const tareaDb = await prisma.tarea.findUnique({
      where: { id: importRes.tareaId },
    });
    expect(tareaDb).not.toBeNull();
    expect(tareaDb?.createdAt.getDay()).toBe(0); // Domingo
  });
});
