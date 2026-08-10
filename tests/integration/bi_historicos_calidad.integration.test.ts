import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../../src/db";
import { Rol, Estatus, EstadoFalla, CalidadDato, EstadoTarea } from "@prisma/client";
import { BIMetricsService } from "../../src/modules/bi_maquinaria/services/bi_metrics_service";

const RUN_PREFIX = `TEST_BI_HIST_${Date.now()}`;

// Validación de base de datos de pruebas
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("_test")) {
  console.error("DATABASE_URL DE PRODUCCIÓN/DESARROLLO DETECTADA:", databaseUrl);
  throw new Error("ABORTANDO: Las pruebas de integración deben correr exclusivamente con DATABASE_URL apuntando a una base de pruebas que termine en '_test' (mantenimiento_test).");
}

describe("BI Maquinaria - Integración Históricos Estimados (mantenimiento_test)", () => {
  let deptoId: number;
  let clienteId: number;
  let maquinaId: number;
  let tecnicoId: number;

  beforeAll(async () => {
    // Buscar o crear depto
    let depto = await prisma.departamento.findFirst({ where: { nombre: `${RUN_PREFIX}_Depto` } });
    if (!depto) {
      depto = await prisma.departamento.create({
        data: {
          nombre: `${RUN_PREFIX}_Depto`,
          planta: "Planta Test",
          tipo: "Operativo"
        }
      });
    }
    deptoId = depto.id;

    // Crear cliente interno
    const cliente = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_cli`,
        nombre: "Cliente Interno Prueba",
        email: `cli_${RUN_PREFIX}@cuadra.com`,
        password: "securepassword",
        rol: Rol.CLIENTE_INTERNO,
        estado: Estatus.ACTIVO,
        departamentoId: deptoId
      }
    });
    clienteId = cliente.id;

    // Crear técnico
    const tecnico = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_tec`,
        nombre: "Técnico Prueba",
        email: `tec_${RUN_PREFIX}@cuadra.com`,
        password: "securepassword",
        rol: Rol.TECNICO,
        estado: Estatus.ACTIVO,
        departamentoId: deptoId
      }
    });
    tecnicoId = tecnico.id;

    // Crear máquina
    const maquina = await prisma.maquina.create({
      data: {
        codigo: `MBC_${RUN_PREFIX.substring(0, 4)}`,
        nombre: "Máquina de Prueba Histórica",
        proceso: "Cortar",
        area: "Planta A",
        criticidad: "A",
        estado: "ACTIVA"
      }
    });
    maquinaId = maquina.id;

    // Crear Tarea e Histórico Estimado
    const tarea = await prisma.tarea.create({
      data: {
        titulo: `${RUN_PREFIX} Tarea Histórica`,
        tipo: "TICKET",
        clasificacion: "CORRECTIVO",
        estado: EstadoTarea.CERRADO,
        creadorId: clienteId,
        maquinaId: maquinaId,
        duracionReal: 120,
        fechaInicio: new Date("2025-05-10T10:00:00Z"),
        finalizadoAt: new Date("2025-05-10T12:00:00Z"),
        descripcion: "Correctivo histórico de prueba"
      }
    });

    await prisma.fallaMaquina.create({
      data: {
        tareaId: tarea.id,
        maquinaId: maquinaId,
        estado: EstadoFalla.CERRADA,
        calidadDato: CalidadDato.HISTORICO_ESTIMADO,
        contabilizaComoFalla: true,
        fechaFallaReportada: new Date("2025-05-10T10:00:00Z"),
        fechaFallaConfirmada: new Date("2025-05-10T10:00:00Z"),
        fechaRestauracion: new Date("2025-05-10T12:00:00Z"),
        confirmadoPorId: null,
        snapshotCodigo: maquina.codigo,
        snapshotProceso: maquina.proceso
      }
    });

    await prisma.intervaloTiempo.create({
      data: {
        tareaId: tarea.id,
        inicio: new Date("2025-05-10T10:00:00Z"),
        fin: new Date("2025-05-10T12:00:00Z"),
        duracion: 120,
        usuarioId: tecnicoId,
        estado: EstadoTarea.CERRADO
      }
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.intervaloTiempo.deleteMany({ where: { usuarioId: tecnicoId } });
    await prisma.fallaMaquina.deleteMany({ where: { maquinaId: maquinaId } });
    await prisma.tarea.deleteMany({ where: { creadorId: clienteId } });
    await prisma.maquina.deleteMany({ where: { id: maquinaId } });
    await prisma.usuario.deleteMany({ where: { id: { in: [clienteId, tecnicoId] } } });
    await prisma.departamento.deleteMany({ where: { id: deptoId } });
  });

  it("debe excluir fallas HISTORICO_ESTIMADO si incluirHistoricos es false", async () => {
    const maquina = await prisma.maquina.findUnique({ where: { id: maquinaId } });
    expect(maquina).not.toBeNull();

    const desde = new Date("2025-05-01T00:00:00Z");
    const hasta = new Date("2025-05-31T23:59:59Z");

    const res = await BIMetricsService.calcularMetricasMaquinas(
      [maquina!],
      desde,
      hasta,
      "CONFIRMADOS_E_INCOMPLETOS",
      new Date(),
      false // incluirHistoricos = false
    );

    const metricas = res[0];
    expect(metricas).not.toBeUndefined();
    if (metricas) {
      expect(metricas.frecuencia.valor).toBe(0);
      expect(metricas.mttr.sumaMinutosTrabajoTecnico).toBe(0);
      expect(metricas.mttr.estado).toBe("SIN_DATOS");
    }
  });

  it("debe incluir fallas HISTORICO_ESTIMADO y sumar tiempo si incluirHistoricos es true", async () => {
    const maquina = await prisma.maquina.findUnique({ where: { id: maquinaId } });
    expect(maquina).not.toBeNull();

    const desde = new Date("2025-05-01T00:00:00Z");
    const hasta = new Date("2025-05-31T23:59:59Z");

    const res = await BIMetricsService.calcularMetricasMaquinas(
      [maquina!],
      desde,
      hasta,
      "CONFIRMADOS_E_INCOMPLETOS",
      new Date(),
      true // incluirHistoricos = true
    );

    const metricas = res[0];
    expect(metricas).not.toBeUndefined();
    if (metricas) {
      expect(metricas.frecuencia.valor).toBe(1);
      expect(metricas.mttr.sumaMinutosTrabajoTecnico).toBe(120);
      expect(metricas.mttr.estado).toBe("CALCULABLE");
    }
  });
});
