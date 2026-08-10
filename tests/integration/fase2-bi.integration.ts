import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../../src/db";
import { Rol, Estatus, ImpactoProduccionConfirmado, EstadoFalla, CalidadDato, TipoParo } from "@prisma/client";
import { getBIKPISController, getBIDetailController, getBIFiltrosController } from "../../src/modules/bi_maquinaria/controllers/bi_metrics_controller";
import { getMaquinaKPIs } from "../../src/modules/maquinas/01_list";
import { authenticate } from "../../src/middlewares/authenticate";
import { authorize } from "../../src/middlewares/authorize";
import { ejecutarAutoPausaFinTurno } from "../../src/modules/tickets/automations";

const RUN_PREFIX = `TEST_BI_FASE2_${Date.now()}`;

// 1. Aislamiento y validación de base de datos de pruebas
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !databaseUrl.includes("_test")) {
  console.error("DATABASE_URL DE PRODUCCIÓN/DESARROLLO DETECTADA:", databaseUrl);
  throw new Error("ABORTANDO: Las pruebas de integración deben correr exclusivamente con DATABASE_URL apuntando a una base de pruebas que termine en '_test' (mantenimiento_test).");
}

describe("BI Maquinaria - Fase 2 Integración (mantenimiento_test)", () => {
  let deptoId: number;
  let superAdminUser: any;
  let jefeUser: any;
  let coordUser: any;
  let tecnicoUser: any;

  let maquina1Id: number;
  let maquina2Id: number;
  let maquinaSinAreaId: number;

  const maquinasIds = () => [maquina1Id, maquina2Id, maquinaSinAreaId].filter((id) => Number.isInteger(id));

  const resetAnalyticData = async () => {
    const ids = maquinasIds();
    const tareas = await prisma.tarea.findMany({
      where: {
        OR: [
          { maquinaId: { in: ids } },
          { titulo: { startsWith: RUN_PREFIX } },
        ],
      },
      select: { id: true },
    });
    const tareaIds = tareas.map((t) => t.id);

    await prisma.intervaloParoMaquina.deleteMany({ where: { maquinaId: { in: ids } } });
    await prisma.fallaMaquina.deleteMany({ where: { maquinaId: { in: ids } } });
    await prisma.intervaloTiempo.deleteMany({ where: { tareaId: { in: tareaIds } } });
    await prisma.historialTarea.deleteMany({ where: { tareaId: { in: tareaIds } } });
    await prisma.imagen.deleteMany({ where: { tareaId: { in: tareaIds } } });
    await prisma.notificacion.deleteMany({ where: { tareaId: { in: tareaIds } } });
    await prisma.tarea.deleteMany({
      where: {
        OR: [
          { maquinaId: { in: ids } },
          { titulo: { startsWith: RUN_PREFIX } },
        ],
      },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();

    // 1. Crear Departamento
    const depto = await prisma.departamento.create({
      data: {
        nombre: `${RUN_PREFIX}_DEPTO`,
        planta: "Planta Test F2",
        tipo: "Produccion",
      },
    });
    deptoId = depto.id;

    // 2. Crear Usuarios con diferentes roles
    superAdminUser = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_superadmin`,
        password: "hashed_password",
        nombre: "Super Admin F2",
        rol: Rol.SUPER_ADMIN,
        departamentoId: deptoId,
      },
    });

    jefeUser = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_jefe`,
        password: "hashed_password",
        nombre: "Jefe F2",
        rol: Rol.JEFE_MTTO,
        departamentoId: deptoId,
      },
    });

    coordUser = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_coord`,
        password: "hashed_password",
        nombre: "Coord F2",
        rol: Rol.COORDINADOR_MTTO,
        departamentoId: deptoId,
      },
    });

    tecnicoUser = await prisma.usuario.create({
      data: {
        username: `${RUN_PREFIX}_tecnico`,
        password: "hashed_password",
        nombre: "Tecnico F2",
        rol: Rol.TECNICO,
        departamentoId: deptoId,
      },
    });

    // 3. Crear Máquinas
    const m1 = await prisma.maquina.create({
      data: {
        codigo: `${RUN_PREFIX}_MBC_M1`,
        nombre: "Prensa Inyectora A",
        proceso: "Inyeccion",
        estado: "OPERATIVA",
        planta: "Planta Test F2",
        area: "Moldeo",
        criticidad: "A",
        createdAt: new Date("2026-07-01T00:00:00-06:00"),
      },
    });
    maquina1Id = m1.id;

    const m2 = await prisma.maquina.create({
      data: {
        codigo: `${RUN_PREFIX}_MBC_M2`,
        nombre: "Prensa Inyectora B",
        proceso: "Inyeccion",
        estado: "OPERATIVA",
        planta: "Planta Test F2",
        area: "Acabado",
        criticidad: "B",
        createdAt: new Date("2026-07-15T00:00:00-06:00"), // Creada a mitad de mes
      },
    });
    maquina2Id = m2.id;

    const mSinArea = await prisma.maquina.create({
      data: {
        codigo: `${RUN_PREFIX}_MBC_MSIN`,
        nombre: "Extrusora C",
        proceso: "Extrusion",
        estado: "OPERATIVA",
        planta: "Planta Test F2",
        area: null, // Sin área
        criticidad: "C",
        createdAt: new Date("2026-07-01T00:00:00-06:00"),
      },
    });
    maquinaSinAreaId = mSinArea.id;
  });

  afterAll(async () => {
    // 50. Las pruebas limpian exclusivamente sus propios datos
    await resetAnalyticData();
    await prisma.maquina.deleteMany({ where: { id: { in: maquinasIds() } } });
    await prisma.notificacionLog.deleteMany({ where: { usuarioId: { in: [superAdminUser.id, jefeUser.id, coordUser.id, tecnicoUser.id] } } });
    await prisma.bitacora.deleteMany({ where: { usuarioId: { in: [superAdminUser.id, jefeUser.id, coordUser.id, tecnicoUser.id] } } });
    await prisma.usuario.deleteMany({ where: { username: { startsWith: RUN_PREFIX } } });
    await prisma.departamento.deleteMany({ where: { id: deptoId } });
    await prisma.$disconnect();
  });

  // Helpers para simular Express
  const mockRes = () => {
    const res: any = {};
    res.statusCode = 200;
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (data: any) => {
      res.body = data;
      return res;
    };
    return res;
  };

  const mockReq = (user: any, query: any = {}, params: any = {}) => {
    return {
      user,
      query,
      params,
    } as any;
  };

  const baseQuery = () => ({
    desde: "2026-08-01T00:00:00-06:00",
    hasta: "2026-08-04T00:00:00-06:00",
    agrupacion: "EQUIPO",
  });

  const findEquipoRow = (rows: any[], maquinaId: number) =>
    rows.find((row: any) => row.equipo?.id === maquinaId);

  const expectNoNaNOrInfinity = (value: unknown) => {
    if (typeof value === "number") {
      expect(Number.isNaN(value)).toBe(false);
      expect(Number.isFinite(value)).toBe(true);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) expectNoNaNOrInfinity(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) expectNoNaNOrInfinity(item);
    }
  };

  // 1. autenticación requerida
  it("1. debe fallar si no hay autenticación", async () => {
    const req = { headers: {} } as any;
    const res = mockRes();
    let nextCalled = false;
    await authenticate(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  // 2. técnico sin rol supervisor recibe 403
  it("2. técnico sin rol supervisor recibe 403 en endpoints BI", async () => {
    const req = mockReq(tecnicoUser);
    const res = mockRes();
    let nextCalled = false;
    const authorizeBIMiddleware = authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]);
    authorizeBIMiddleware(req, res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  // 3, 4, 5. SUPER_ADMIN, JEFE_MTTO, COORDINADOR_MTTO acceden
  it("3, 4, 5. roles autorizados BI acceden con éxito", async () => {
    const authorizeBIMiddleware = authorize([Rol.SUPER_ADMIN, Rol.JEFE_MTTO, Rol.COORDINADOR_MTTO]);

    for (const user of [superAdminUser, jefeUser, coordUser]) {
      const req = mockReq(user);
      const res = mockRes();
      let nextCalled = false;
      authorizeBIMiddleware(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    }
  });

  // 6. periodo inválido devuelve 400
  it("6. periodo inválido (desde >= hasta) devuelve 400", async () => {
    const req = mockReq(superAdminUser, {
      desde: "2026-08-05T00:00:00-06:00",
      hasta: "2026-08-01T00:00:00-06:00",
    });
    const res = mockRes();
    await getBIKPISController(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("BI_INVALID_PARAMS");
  });

  // 7. fecha sin offset devuelve 400
  it("7. fecha sin offset devuelve 400", async () => {
    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00", // Sin offset
      hasta: "2026-08-05T00:00:00-06:00",
    });
    const res = mockRes();
    await getBIKPISController(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("BI_INVALID_PARAMS");
  });

  // 8. hasta exclusivo & 9. máquina sin fallas aparece
  it("8, 9. hasta es exclusivo y las máquinas sin fallas aparecen en el listado", async () => {
    await resetAnalyticData();
    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        estado: EstadoFalla.REHABILITADA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaReportada: new Date("2026-08-04T00:00:00-06:00"),
        fechaFallaConfirmada: new Date("2026-08-04T00:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-04T01:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
        snapshotProceso: "Inyeccion",
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-04T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    //MBC-M1 debe aparecer aunque no tenga fallas
    const items = res.body.data;
    const m1Row = items.find((row: any) => row.equipo?.id === maquina1Id);
    expect(m1Row).toBeDefined();
    expect(m1Row.metricas.frecuencia.valor).toBe(0);
    expect(m1Row.metricas.disponibilidad.valorPorcentaje).toBe(100);
  });

  // 10, 11, 12. Frecuencia incluye abiertas, MTTR excluye abiertas, MTTR usa confirmada y restauración
  it("10, 11, 12. Frecuencia y MTTR validan correctamente fallas abiertas y cerradas", async () => {
    await resetAnalyticData();

    const tareaRestaurada = await prisma.tarea.create({
      data: {
        titulo: `${RUN_PREFIX}_MTTR_TECNICO_1`,
        descripcion: "Trabajo técnico de prueba",
        maquinaId: maquina1Id,
        estado: "RESUELTO",
        creadorId: superAdminUser.id,
        clasificacion: "CORRECTIVO",
        tipo: "TICKET",
        duracionReal: 60,
        createdAt: new Date("2026-08-02T10:00:00-06:00"),
        finalizadoAt: new Date("2026-08-02T11:00:00-06:00"),
      },
    });

    await prisma.intervaloTiempo.create({
      data: {
        tareaId: tareaRestaurada.id,
        usuarioId: superAdminUser.id,
        estado: "EN_PROGRESO",
        inicio: new Date("2026-08-02T10:00:00-06:00"),
        fin: new Date("2026-08-02T11:00:00-06:00"),
        duracion: 60,
      },
    });

    // Falla 1: confirmada y restaurada (MTTR técnico = 60 min)
    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tareaId: tareaRestaurada.id,
        estado: EstadoFalla.REHABILITADA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaReportada: new Date("2026-08-02T10:00:00-06:00"),
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-02T11:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: "MBC-M1",
        snapshotProceso: "Inyeccion",
      },
    });

    // Falla 2: confirmada y abierta
    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        estado: EstadoFalla.ABIERTA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaReportada: new Date("2026-08-03T10:00:00-06:00"),
        fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"),
        fechaRestauracion: null,
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: "MBC-M1",
        snapshotProceso: "Inyeccion",
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);

    expect(res.statusCode).toBe(200);
    const m1Row = res.body.data.find((row: any) => row.equipo?.id === maquina1Id);
    expect(m1Row).toBeDefined();
    // Frecuencia total = 2 (1 abierta + 1 restaurada)
    expect(m1Row.metricas.frecuencia.valor).toBe(2);
    expect(m1Row.metricas.frecuencia.fallasAbiertas).toBe(1);
    expect(m1Row.metricas.frecuencia.fallasRestauradas).toBe(1);
    // MTTR técnico usa solo la restaurada con intervalo técnico válido = 60 min
    expect(m1Row.metricas.mttr.valorMinutos).toBe(60);
    expect(m1Row.metricas.mttr.sumaMinutosTrabajoTecnico).toBe(60);
    expect(m1Row.metricas.restauracionCalendario.valorPromedioMinutos).toBe(60);
    expect(m1Row.metricas.mttr.fallasRestauradasUsadas).toBe(1);
    expect(m1Row.metricas.mttr.fallasAbiertasExcluidas).toBe(1);
  });

  // 13, 14. MTBF usa restauración anterior al periodo y acepta abierta como siguiente
  it("13, 14. MTBF cruza periodos y calcula con falla abierta como fin de intervalo", async () => {
    // Limpiar fallas previas de este test
    await resetAnalyticData();

    // Falla 1: creada y restaurada antes del periodo
    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        estado: EstadoFalla.REHABILITADA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaReportada: new Date("2026-07-25T10:00:00-06:00"),
        fechaFallaConfirmada: new Date("2026-07-25T10:00:00-06:00"),
        fechaRestauracion: new Date("2026-07-28T10:00:00-06:00"), // fin anterior = 28 Jul
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: "MBC-M1",
        snapshotProceso: "Inyeccion",
      },
    });

    // Falla 2: abierta dentro del periodo
    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        estado: EstadoFalla.ABIERTA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
        fechaFallaReportada: new Date("2026-08-02T10:00:00-06:00"), // inicio siguiente = 2 Ago (5 días de intervalo)
        fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
        fechaRestauracion: null,
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: "MBC-M1",
        snapshotProceso: "Inyeccion",
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);

    expect(res.statusCode).toBe(200);
    const m1Row = res.body.data.find((row: any) => row.equipo?.id === maquina1Id);
    expect(m1Row).toBeDefined();
    // MTBF debe ser 5 días
    expect(m1Row.metricas.mtbf.valorDias).toBe(5);
    expect(m1Row.metricas.mtbf.intervalosValidos).toBe(1);
  });

  // 15, 16, 17, 18. Paros: total, parcial, incompleto, planificado
  it("15, 16, 17, 18. Disponibilidad maneja correctamente los diferentes tipos de impactos y paros", async () => {
    await resetAnalyticData();

    // Paro total de 2 horas (120 min)
    await prisma.intervaloParoMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tipo: TipoParo.NO_PLANIFICADO,
        impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
      },
    });

    // Paro parcial con 50% de afectación durante 2 horas (60 min equivalentes)
    await prisma.intervaloParoMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tipo: TipoParo.NO_PLANIFICADO,
        impacto: ImpactoProduccionConfirmado.PARO_PARCIAL,
        porcentajeAfectacion: 50,
        inicio: new Date("2026-08-01T14:00:00-06:00"),
        fin: new Date("2026-08-01T16:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
      },
    });

    // Paro planificado (preventivo) que no reduce disponibilidad
    await prisma.intervaloParoMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tipo: TipoParo.PLANIFICADO,
        impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T18:00:00-06:00"),
        fin: new Date("2026-08-01T19:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-02T00:00:00-06:00", // 1 día (1440 min)
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);

    expect(res.statusCode).toBe(200);
    const m1Row = res.body.data.find((row: any) => row.equipo?.id === maquina1Id);
    expect(m1Row).toBeDefined();
    // Paros equivalentes = 120 + 60 = 180 min
    // (1440 - 180) / 1440 * 100 = 87.5%
    expect(m1Row.metricas.disponibilidad.valorPorcentaje).toBeCloseTo(87.5, 3);
    expect(m1Row.metricas.disponibilidad.minutosParoPlanificado).toBe(60);
  });

  // 17. Paro parcial sin porcentaje produce DATO_INCOMPLETO
  it("17. Paro parcial sin porcentaje produce DATO_INCOMPLETO y disponibilidad nula", async () => {
    await resetAnalyticData();

    await prisma.intervaloParoMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tipo: TipoParo.NO_PLANIFICADO,
        impacto: ImpactoProduccionConfirmado.PARO_PARCIAL,
        porcentajeAfectacion: null, // Incompleto
        inicio: new Date("2026-08-01T10:00:00-06:00"),
        fin: new Date("2026-08-01T12:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
        calidadDato: CalidadDato.DATO_INCOMPLETO,
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-02T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);

    const m1Row = res.body.data.find((row: any) => row.equipo?.id === maquina1Id);
    expect(m1Row.metricas.disponibilidad.valorPorcentaje).toBeNull();
    expect(m1Row.metricas.disponibilidad.estado).toBe("DATO_INCOMPLETO");
    expect(m1Row.metricas.disponibilidad.minutosParoEquivalentes).toBe(0);
    expect(m1Row.metricas.disponibilidad.minutosParcialesSinPorcentaje).toBe(120);
  });

  // 19. Paro abierto llega hasta ahora
  it("19. Paro abierto se calcula extendiéndose hasta la fecha ahora", async () => {
    await resetAnalyticData();

    // Paro abierto desde las 22:00 del 1 de agosto, filtrado hasta medianoche
    await prisma.intervaloParoMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tipo: TipoParo.NO_PLANIFICADO,
        impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
        porcentajeAfectacion: 100,
        inicio: new Date("2026-08-01T22:00:00-06:00"),
        fin: null, // abierto
        confirmadoPorId: superAdminUser.id,
      },
    });

    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-02T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);

    const m1Row = res.body.data.find((row: any) => row.equipo?.id === maquina1Id);
    // Debe durar exactamente 2 horas (120 min) recortado a la medianoche
    expect(m1Row.metricas.disponibilidad.minutosParoEquivalentes).toBe(120);
    expect(m1Row.metricas.disponibilidad.advertencias).toContain("PARO_ABIERTO");
  });

  // 20. Intervalos superpuestos
  it("20. paros totales superpuestos se fusionan y disponibilidad sigue calculable", async () => {
    await resetAnalyticData();

    await prisma.intervaloParoMaquina.createMany({
      data: [
        {
          maquinaId: maquina1Id,
          tipo: TipoParo.NO_PLANIFICADO,
          impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
          porcentajeAfectacion: 100,
          inicio: new Date("2026-08-01T10:00:00-06:00"),
          fin: new Date("2026-08-01T12:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
        },
        {
          maquinaId: maquina1Id,
          tipo: TipoParo.NO_PLANIFICADO,
          impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
          porcentajeAfectacion: 100,
          inicio: new Date("2026-08-01T11:00:00-06:00"),
          fin: new Date("2026-08-01T13:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
        },
      ],
    });

    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, baseQuery()), res);

    const m1Row = findEquipoRow(res.body.data, maquina1Id);
    expect(m1Row.metricas.disponibilidad.valorPorcentaje).toBeCloseTo(95.8333, 3);
    expect(m1Row.metricas.disponibilidad.minutosParoEquivalentes).toBe(180);
    expect(m1Row.metricas.disponibilidad.estado).toBe("CALCULABLE");
    expect(m1Row.metricas.disponibilidad.advertencias).toContain("INTERVALOS_PARO_FUSIONADOS");
  });

  // 26, 27, 28. Minutos-máquina y suma de bases en proceso/área
  it("26, 27, 28. agrupaciones usan minutos-máquina y suman bases por proceso y área", async () => {
    await resetAnalyticData();

    await prisma.intervaloParoMaquina.createMany({
      data: [
        {
          maquinaId: maquina1Id,
          tipo: TipoParo.NO_PLANIFICADO,
          impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
          porcentajeAfectacion: 100,
          inicio: new Date("2026-07-20T10:00:00-06:00"),
          fin: new Date("2026-07-20T11:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
        },
        {
          maquinaId: maquina2Id,
          tipo: TipoParo.NO_PLANIFICADO,
          impacto: ImpactoProduccionConfirmado.PARO_TOTAL,
          porcentajeAfectacion: 100,
          inicio: new Date("2026-07-20T12:00:00-06:00"),
          fin: new Date("2026-07-20T14:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
        },
      ],
    });

    const periodo = {
      desde: "2026-07-20T00:00:00-06:00",
      hasta: "2026-07-22T00:00:00-06:00",
    };

    const resProceso = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...periodo, agrupacion: "PROCESO" }), resProceso);
    const inyGroup = resProceso.body.data.find((row: any) => row.proceso === "Inyeccion");
    expect(inyGroup.cantidadMaquinas).toBe(2);
    expect(inyGroup.metricas.disponibilidad.minutosMaquinaObservados).toBe(5760);
    expect(inyGroup.metricas.disponibilidad.minutosParoEquivalentes).toBe(180);

    const resArea = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...periodo, agrupacion: "AREA", area: "Moldeo" }), resArea);
    expect(resArea.body.data).toHaveLength(1);
    expect(resArea.body.data[0].area).toBe("Moldeo");
    expect(resArea.body.data[0].metricas.disponibilidad.minutosMaquinaObservados).toBe(2880);
    expect(resArea.body.data[0].metricas.disponibilidad.minutosParoEquivalentes).toBe(60);
  });

  // 29. Confiabilidad a horizontes oficiales
  it("29. confiabilidad devuelve horizontes 1, 7, 30 y 90 días desde MTBF agregado", async () => {
    await resetAnalyticData();

    await prisma.fallaMaquina.createMany({
      data: [
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.REHABILITADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-07-25T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-07-25T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-07-28T10:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.REHABILITADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-08-02T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-08-02T12:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
      ],
    });

    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, baseQuery()), res);
    const m1Row = findEquipoRow(res.body.data, maquina1Id);

    expect(m1Row.metricas.mtbf.valorDias).toBe(5);
    expect(m1Row.metricas.confiabilidad.r1DiaPorcentaje).toBeGreaterThan(0);
    expect(m1Row.metricas.confiabilidad.r7DiasPorcentaje).toBeGreaterThan(0);
    expect(m1Row.metricas.confiabilidad.r30DiasPorcentaje).toBeGreaterThan(0);
    expect(m1Row.metricas.confiabilidad.r90DiasPorcentaje).toBeGreaterThan(0);
    expect(m1Row.metricas.confiabilidad.r1DiaPorcentaje).toBeGreaterThan(m1Row.metricas.confiabilidad.r7DiasPorcentaje);
  });

  // 21, 22, 23. Agrupaciones EQUIPO, PROCESO, AREA
  it("21, 22, 23. Agrupaciones tridimensionales computan de forma correcta", async () => {
    const reqProceso = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "PROCESO",
    });
    const resProceso = mockRes();
    await getBIKPISController(reqProceso, resProceso);
    expect(resProceso.statusCode).toBe(200);
    expect(resProceso.body.metadata.agrupacion).toBe("PROCESO");
    // Debe haber un grupo 'Inyeccion'
    const inyGroup = resProceso.body.data.find((row: any) => row.proceso === "Inyeccion");
    expect(inyGroup).toBeDefined();

    const reqArea = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "AREA",
    });
    const resArea = mockRes();
    await getBIKPISController(reqArea, resArea);
    expect(resArea.statusCode).toBe(200);
    expect(resArea.body.metadata.agrupacion).toBe("AREA");
  });

  // 24. Área null se conserva fuera de agrupación AREA
  it("24. EQUIPO y PROCESO incluyen máquinas con área null por defecto", async () => {
    const equipoReq = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "EQUIPO",
    });
    const equipoRes = mockRes();
    await getBIKPISController(equipoReq, equipoRes);

    const equipoSinArea = equipoRes.body.data.find((row: any) => row.equipo?.id === maquinaSinAreaId);
    expect(equipoSinArea).toBeDefined();
    expect(equipoSinArea.equipo.area).toBeNull();
    expect(equipoRes.body.metadata.maquinasSinAreaExcluidas).toBe(0);

    const procesoReq = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-04T00:00:00-06:00",
      agrupacion: "PROCESO",
    });
    const procesoRes = mockRes();
    await getBIKPISController(procesoReq, procesoRes);

    const extrusion = procesoRes.body.data.find((row: any) => row.proceso === "Extrusion");
    expect(extrusion).toBeDefined();
    expect(extrusion.cantidadMaquinas).toBe(1);
    expect(extrusion.metricas.disponibilidad.minutosMaquinaObservados).toBe(4320);
    expect(procesoRes.body.metadata.maquinasSinAreaExcluidas).toBe(0);
  });

  // 25. Área null excluida o incluida solo en agrupación AREA
  it("25. AREA excluye null por defecto y lo incluye bajo solicitud sin inventar etiqueta", async () => {
    const defaultReq = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "AREA",
    });
    const defaultRes = mockRes();
    await getBIKPISController(defaultReq, defaultRes);

    expect(defaultRes.body.data.some((row: any) => row.area === null)).toBe(false);
    expect(defaultRes.body.metadata.maquinasSinAreaExcluidas).toBe(1);

    const includeReq = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "AREA",
      incluirAreaNula: "true",
    });
    const includeRes = mockRes();
    await getBIKPISController(includeReq, includeRes);

    const nullAreaGroup = includeRes.body.data.find((row: any) => row.area === null);
    expect(nullAreaGroup).toBeDefined();
    expect(nullAreaGroup.area).toBeNull();
    expect(nullAreaGroup.key).toBe("null_area");
    expect(includeRes.body.data.some((row: any) => ["Sin área", "GENERAL", "N/A"].includes(row.area))).toBe(false);
    expect(includeRes.body.metadata.maquinasSinAreaExcluidas).toBe(0);
  });

  // 30. Máquina creada a mitad de periodo
  it("30. Máquina creada a mitad de periodo computa solo el periodo en que existió", async () => {
    const req = mockReq(superAdminUser, {
      desde: "2026-07-01T00:00:00-06:00",
      hasta: "2026-08-01T00:00:00-06:00", // 31 días total
      agrupacion: "EQUIPO",
    });
    const res = mockRes();
    await getBIKPISController(req, res);
    // MBC-M2 se creó el 15 de julio, por lo que debe tener ~17 días de tiempo observado
    const m2Row = res.body.data.find((row: any) => row.equipo?.id === maquina2Id);
    expect(m2Row).toBeDefined();
    // 17 días = 24480 minutos
    expect(m2Row.metricas.disponibilidad.minutosMaquinaObservados).toBe(24480);
  });

  // 31, 32, 33, 34, 35, 36. Filtros de catálogo y búsqueda
  it("31, 32, 33, 34, 35, 36. filtros proceso, área, criticidad, estado y búsqueda por código/nombre funcionan", async () => {
    const byProceso = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), proceso: "Inyeccion" }), byProceso);
    expect(byProceso.body.data.length).toBeGreaterThan(0);
    expect(byProceso.body.data.every((row: any) => row.equipo.proceso === "Inyeccion")).toBe(true);

    const byArea = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), area: "Moldeo", incluirAreaNula: "true" }), byArea);
    expect(byArea.body.data).toHaveLength(1);
    expect(byArea.body.data[0].equipo.id).toBe(maquina1Id);
    expect(byArea.body.data[0].equipo.area).toBe("Moldeo");
    expect(byArea.body.data.some((row: any) => row.equipo?.id === maquina2Id)).toBe(false);
    expect(byArea.body.data.some((row: any) => row.equipo?.id === maquinaSinAreaId)).toBe(false);

    const byCriticidad = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), criticidad: "B" }), byCriticidad);
    expect(byCriticidad.body.data).toHaveLength(1);
    expect(byCriticidad.body.data[0].equipo.criticidad).toBe("B");

    const byEstado = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), estadoMaquina: "OPERATIVA" }), byEstado);
    expect(byEstado.body.data.every((row: any) => row.equipo.estadoActual === "OPERATIVA")).toBe(true);

    const byCodigo = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), buscar: `${RUN_PREFIX}_MBC_M1` }), byCodigo);
    expect(byCodigo.body.data).toHaveLength(1);
    expect(byCodigo.body.data[0].equipo.id).toBe(maquina1Id);

    const byNombre = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), buscar: "Prensa Inyectora B" }), byNombre);
    expect(byNombre.body.data).toHaveLength(1);
    expect(byNombre.body.data[0].equipo.id).toBe(maquina2Id);
  });

  it("32b. falla sin confirmadoPorId queda fuera de métricas oficiales y detalle", async () => {
    await resetAnalyticData();

    const tareaValida = await prisma.tarea.create({
      data: {
        titulo: `${RUN_PREFIX}_MTTR_CONFIRMADOR_VALIDO`,
        descripcion: "Trabajo técnico válido",
        maquinaId: maquina1Id,
        estado: "RESUELTO",
        creadorId: superAdminUser.id,
        clasificacion: "CORRECTIVO",
        tipo: "TICKET",
        duracionReal: 60,
        createdAt: new Date("2026-08-03T10:00:00-06:00"),
        finalizadoAt: new Date("2026-08-03T11:00:00-06:00"),
      },
    });

    await prisma.intervaloTiempo.create({
      data: {
        tareaId: tareaValida.id,
        usuarioId: superAdminUser.id,
        estado: "EN_PROGRESO",
        inicio: new Date("2026-08-03T10:00:00-06:00"),
        fin: new Date("2026-08-03T11:00:00-06:00"),
        duracion: 60,
      },
    });

    await prisma.fallaMaquina.createMany({
      data: [
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.CERRADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-07-25T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-07-25T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-07-25T11:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.CERRADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-08-02T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-08-02T11:00:00-06:00"),
          confirmadoPorId: null,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
        {
          maquinaId: maquina1Id,
          tareaId: tareaValida.id,
          estado: EstadoFalla.CERRADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-08-03T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-03T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-08-03T11:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
      ],
    });

    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "EQUIPO",
      maquinaId: String(maquina1Id),
    }), res);

    const row = res.body.data[0];
    expect(res.statusCode).toBe(200);
    expect(row.metricas.frecuencia.valor).toBe(1);
    expect(row.metricas.mttr.valorMinutos).toBe(60);
    expect(row.metricas.mtbf.intervalosValidos).toBe(1);
    expect(row.metricas.mtbf.valorMinutos).toBe(12900);
    expect(row.calidadDatos.invalidos).toBeGreaterThanOrEqual(1);

    const detailRes = mockRes();
    await getBIDetailController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
    }, { maquinaId: String(maquina1Id) }), detailRes);

    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body.fallas.incluidas).toHaveLength(1);
    expect(detailRes.body.fallas.excluidas).toHaveLength(1);
    expect(detailRes.body.fallas.excluidas[0].razonExclusion).toBe("SIN_CONFIRMADOR");
  });

  // 37, 38, 39. Ordenamiento, null al final y paginación
  it("37, 38, 39. ordena filas, deja null al final y pagina resultados agrupados", async () => {
    const reqPage1 = mockReq(superAdminUser, {
      ...baseQuery(),
      agrupacion: "AREA",
      incluirAreaNula: "true",
      ordenarPor: "NOMBRE",
      direccion: "ASC",
      pagina: "1",
      limite: "2",
    });
    const resPage1 = mockRes();
    await getBIKPISController(reqPage1, resPage1);

    expect(resPage1.body.metadata.paginacion.pagina).toBe(1);
    expect(resPage1.body.metadata.paginacion.limite).toBe(2);
    expect(resPage1.body.metadata.paginacion.totalRegistros).toBe(3);
    expect(resPage1.body.data.map((row: any) => row.area)).toEqual(["Acabado", "Moldeo"]);

    const resPage2 = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...reqPage1.query, pagina: "2" }), resPage2);
    expect(resPage2.body.data).toHaveLength(1);
    expect(resPage2.body.data[0].area).toBeNull();
  });

  // 40. Endpoint detalle
  it("40. Endpoint detalle devuelve las métricas y el catálogo correctos", async () => {
    const req = mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      paginaEventos: 1,
      limiteEventos: 10,
    }, {
      maquinaId: maquina1Id,
    });
    const res = mockRes();
    await getBIDetailController(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.maquina.id).toBe(maquina1Id);
    expect(res.body.metricas).toBeDefined();
    expect(res.body.eventos).toBeDefined();
    expect(res.body.metadata.paginacionEventos).toBeDefined();
    expect(res.body.maquina.codigo).toBe(`${RUN_PREFIX}_MBC_M1`);
    expect(res.body.maquina.nombre).toBe("Prensa Inyectora A");
    expect(res.body.fallas).toBeDefined();
    expect(res.body.fallas.incluidas).toBeDefined();
    expect(res.body.fallas.excluidas).toBeDefined();
    expect(res.body.paros.originales).toBeDefined();
    expect(res.body.paros.recortados).toBeDefined();
    expect(res.body.paros.planificados).toBeDefined();
    expect(res.body.mtbf.intervalos).toBeDefined();
  });

  // 41. Endpoint filtros
  it("41. Endpoint filtros devuelve listas ordenadas alfabéticamente", async () => {
    const req = mockReq(superAdminUser);
    const res = mockRes();
    await getBIFiltrosController(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.procesos).toContain("Inyeccion");
    expect(res.body.data.areas).toContain("Moldeo");
    expect(res.body.data.areas).not.toContain(null);
    expect(res.body.data.procesos).toEqual([...res.body.data.procesos].sort((a, b) => a.localeCompare(b)));
    expect(res.body.data.areas).toEqual([...res.body.data.areas].sort((a, b) => a.localeCompare(b)));
    expect(res.body.metadata.maquinasTotales).toBeGreaterThanOrEqual(3);
    expect(res.body.metadata.maquinasConAreaNula).toBeGreaterThanOrEqual(1);
  });

  // 42, 43, 44. Históricos, provisionales y descartadas excluidos
  it("42, 43, 44. históricos estimados, provisionales y descartadas quedan excluidos de métricas oficiales", async () => {
    await resetAnalyticData();

    await prisma.fallaMaquina.createMany({
      data: [
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.REHABILITADA,
          calidadDato: CalidadDato.HISTORICO_ESTIMADO,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-08-02T10:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-02T10:00:00-06:00"),
          fechaRestauracion: new Date("2026-08-02T11:00:00-06:00"),
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.PENDIENTE_DE_DIAGNOSTICO,
          calidadDato: CalidadDato.PROVISIONAL,
          contabilizaComoFalla: true,
          impactoConfirmado: ImpactoProduccionConfirmado.NO_CONFIRMADO,
          fechaFallaReportada: new Date("2026-08-02T12:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-02T12:00:00-06:00"),
          fechaRestauracion: null,
          confirmadoPorId: null,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
        {
          maquinaId: maquina1Id,
          estado: EstadoFalla.DESCARTADA,
          calidadDato: CalidadDato.CONFIRMADO,
          contabilizaComoFalla: false,
          impactoConfirmado: ImpactoProduccionConfirmado.SIN_PARO,
          fechaFallaReportada: new Date("2026-08-02T13:00:00-06:00"),
          fechaFallaConfirmada: new Date("2026-08-02T13:00:00-06:00"),
          fechaRestauracion: null,
          confirmadoPorId: superAdminUser.id,
          snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
          snapshotProceso: "Inyeccion",
        },
      ],
    });

    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, { ...baseQuery(), calidad: "CONFIRMADOS" }), res);
    const m1Row = findEquipoRow(res.body.data, maquina1Id);

    expect(m1Row.metricas.frecuencia.valor).toBe(0);
    expect(m1Row.calidadDatos.historicosExcluidos).toBe(1);
    expect(m1Row.calidadDatos.provisionalesExcluidos).toBe(1);
    expect(m1Row.calidadDatos.confirmados).toBe(0);
    expect(m1Row.calidadDatos.invalidos).toBeGreaterThanOrEqual(1);
  });

  // 45, 46. Sin NaN ni Infinity
  it("45, 46. respuesta completa no contiene NaN ni Infinity", async () => {
    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, baseQuery()), res);
    expect(res.statusCode).toBe(200);
    expectNoNaNOrInfinity(res.body);
  });

  // 47. GET no modifica datos
  it("47. consultas GET de BI no modifican datos", async () => {
    const before = await Promise.all([
      prisma.maquina.count(),
      prisma.fallaMaquina.count(),
      prisma.intervaloParoMaquina.count(),
      prisma.tarea.count(),
    ]);

    const res = mockRes();
    await getBIKPISController(mockReq(superAdminUser, baseQuery()), res);
    expect(res.statusCode).toBe(200);

    const after = await Promise.all([
      prisma.maquina.count(),
      prisma.fallaMaquina.count(),
      prisma.intervaloParoMaquina.count(),
      prisma.tarea.count(),
    ]);
    expect(after).toEqual(before);
  });

  // 48. Contrato de error estable
  it("48. contrato de error estable para parámetros inválidos y defaults explícitos", async () => {
    const invalidKpiCases = [
      { pagina: "-5" },
      { pagina: "0" },
      { pagina: "abc" },
      { limite: "0" },
      { limite: "101" },
      { maquinaId: "abc" },
      { incluirAreaNula: "abc" },
    ];

    for (const query of invalidKpiCases) {
      const res = mockRes();
      await getBIKPISController(mockReq(superAdminUser, {
        ...baseQuery(),
        ...query,
      }), res);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("BI_INVALID_PARAMS");
      expect(typeof res.body.error.message).toBe("string");
    }

    const invalidDetailCases = [
      { query: { paginaEventos: "-1" }, params: { maquinaId: String(maquina1Id) } },
      { query: { limiteEventos: "101" }, params: { maquinaId: String(maquina1Id) } },
      { query: {}, params: { maquinaId: "abc" } },
    ];

    for (const input of invalidDetailCases) {
      const res = mockRes();
      await getBIDetailController(mockReq(superAdminUser, {
        desde: "2026-08-01T00:00:00-06:00",
        hasta: "2026-08-05T00:00:00-06:00",
        ...input.query,
      }, input.params), res);

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("BI_INVALID_PARAMS");
    }

    const defaultsRes = mockRes();
    await getBIKPISController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      pagina: "",
      limite: "",
      incluirAreaNula: "",
      maquinaId: "",
    }), defaultsRes);

    expect(defaultsRes.statusCode).toBe(200);
    expect(defaultsRes.body.metadata.agrupacion).toBe("EQUIPO");
    expect(defaultsRes.body.metadata.paginacion.pagina).toBe(1);
    expect(defaultsRes.body.metadata.paginacion.limite).toBe(25);
    expect(defaultsRes.body.metadata.filtros.incluirAreaNula).toBe(false);
    expect(defaultsRes.body.metadata.filtros.maquinaId).toBeUndefined();

    const detailDefaultsRes = mockRes();
    await getBIDetailController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      paginaEventos: "",
      limiteEventos: "",
    }, { maquinaId: String(maquina1Id) }), detailDefaultsRes);

    expect(detailDefaultsRes.statusCode).toBe(200);
    expect(detailDefaultsRes.body.metadata.paginacionEventos.pagina).toBe(1);
    expect(detailDefaultsRes.body.metadata.paginacionEventos.limite).toBe(25);
  });

  // 50. Limpieza exclusiva de datos de prueba
  it("50. reset de la suite no elimina datos ajenos al prefijo de Fase 2", async () => {
    const sentinel = await prisma.departamento.create({
      data: {
        nombre: `SENTINEL_NO_BORRAR_${Date.now()}`,
        planta: "Sentinel",
        tipo: "QA",
      },
    });

    await resetAnalyticData();
    const stillThere = await prisma.departamento.findUnique({ where: { id: sentinel.id } });
    expect(stillThere).not.toBeNull();

    await prisma.departamento.delete({ where: { id: sentinel.id } });
  });

  it("48a. Fase 2.1 calcula respuesta, MTTR técnico y restauración calendario con el ejemplo completo", async () => {
    await resetAnalyticData();

    const tarea = await prisma.tarea.create({
      data: {
        titulo: `${RUN_PREFIX}_FASE_2_1_EJEMPLO`,
        descripcion: "Ejemplo 120 vs 1020",
        maquinaId: maquina1Id,
        estado: "RESUELTO",
        creadorId: superAdminUser.id,
        clasificacion: "CORRECTIVO",
        tipo: "TICKET",
        duracionReal: 120,
        createdAt: new Date("2026-08-03T16:00:00-06:00"),
        finalizadoAt: new Date("2026-08-04T09:00:00-06:00"),
      },
    });

    await prisma.intervaloTiempo.createMany({
      data: [
        {
          tareaId: tarea.id,
          usuarioId: superAdminUser.id,
          estado: "EN_PROGRESO",
          inicio: new Date("2026-08-03T16:30:00-06:00"),
          fin: new Date("2026-08-03T17:30:00-06:00"),
          duracion: 60,
        },
        {
          tareaId: tarea.id,
          usuarioId: superAdminUser.id,
          estado: "EN_PROGRESO",
          inicio: new Date("2026-08-04T08:00:00-06:00"),
          fin: new Date("2026-08-04T09:00:00-06:00"),
          duracion: 60,
        },
      ],
    });

    await prisma.fallaMaquina.create({
      data: {
        maquinaId: maquina1Id,
        tareaId: tarea.id,
        estado: EstadoFalla.REHABILITADA,
        calidadDato: CalidadDato.CONFIRMADO,
        contabilizaComoFalla: true,
        impactoConfirmado: ImpactoProduccionConfirmado.PARO_TOTAL,
        fechaFallaReportada: new Date("2026-08-03T16:00:00-06:00"),
        fechaFallaConfirmada: new Date("2026-08-03T16:00:00-06:00"),
        fechaRestauracion: new Date("2026-08-04T09:00:00-06:00"),
        confirmadoPorId: superAdminUser.id,
        snapshotCodigo: `${RUN_PREFIX}_MBC_M1`,
        snapshotProceso: "Inyeccion",
        snapshotArea: "Moldeo",
        snapshotCriticidad: "A",
      },
    });

    for (const agrupacion of ["EQUIPO", "PROCESO", "AREA"]) {
      const res = mockRes();
      await getBIKPISController(mockReq(superAdminUser, {
        desde: "2026-08-01T00:00:00-06:00",
        hasta: "2026-08-05T00:00:00-06:00",
        agrupacion,
        ...(agrupacion === "EQUIPO" ? { maquinaId: String(maquina1Id) } : {}),
        ...(agrupacion === "PROCESO" ? { proceso: "Inyeccion" } : {}),
        ...(agrupacion === "AREA" ? { area: "Moldeo" } : {}),
      }), res);

      expect(res.statusCode).toBe(200);
      const row = agrupacion === "EQUIPO"
        ? res.body.data.find((item: any) => item.equipo?.id === maquina1Id)
        : agrupacion === "PROCESO"
          ? res.body.data.find((item: any) => item.proceso === "Inyeccion")
          : res.body.data.find((item: any) => item.area === "Moldeo");
      expect(row).toBeDefined();
      expect(row.metricas.tiempoRespuesta.valorPromedioMinutos).toBe(30);
      expect(row.metricas.mttr.valorMinutos).toBe(120);
      expect(row.metricas.mttr.sumaMinutosTrabajoTecnico).toBe(120);
      expect(row.metricas.restauracionCalendario.valorPromedioMinutos).toBe(1020);
      expect(row.metricas.restauracionCalendario.sumaMinutos).toBe(1020);
      expect(row.metricas.frecuencia.valor).toBe(1);
      expect(row.metricas.mtbf.valorMinutos).toBeNull();
      expect(row.metricas.confiabilidad.estado).toBe("MUESTRA_INSUFICIENTE");
    }

    const orderRes = mockRes();
    await getBIKPISController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
      agrupacion: "EQUIPO",
      ordenarPor: "MTTR",
      direccion: "DESC",
    }), orderRes);
    expect(orderRes.statusCode).toBe(200);
    expect(orderRes.body.data[0].metricas.mttr.valorMinutos).toBe(120);

    const detailRes = mockRes();
    await getBIDetailController(mockReq(superAdminUser, {
      desde: "2026-08-01T00:00:00-06:00",
      hasta: "2026-08-05T00:00:00-06:00",
    }, { maquinaId: String(maquina1Id) }), detailRes);
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.body.metricas.tiempoRespuesta.valorPromedioMinutos).toBe(30);
    expect(detailRes.body.metricas.mttr.valorMinutos).toBe(120);
    expect(detailRes.body.metricas.restauracionCalendario.valorPromedioMinutos).toBe(1020);
    expect(detailRes.body.fallas.restauradas[0].tiempoTecnicoActivoMinutos).toBe(120);
    expect(detailRes.body.fallas.restauradas[0].intervalosTecnicosFusionados).toHaveLength(2);
  });

  it("48b. Auto-pausa de fin de turno cierra intervalos a 17:30 e idempotencia conserva duración", async () => {
    await resetAnalyticData();

    const tarea = await prisma.tarea.create({
      data: {
        titulo: `${RUN_PREFIX}_AUTOPAUSA_1730`,
        descripcion: "Auto pausa fin de turno",
        maquinaId: maquina1Id,
        estado: "EN_PROGRESO",
        creadorId: superAdminUser.id,
        clasificacion: "CORRECTIVO",
        tipo: "TICKET",
        duracionReal: 0,
        createdAt: new Date("2026-08-03T16:00:00-06:00"),
        responsables: { connect: [{ id: tecnicoUser.id }] },
      },
    });

    const intervalo = await prisma.intervaloTiempo.create({
      data: {
        tareaId: tarea.id,
        usuarioId: tecnicoUser.id,
        estado: "EN_PROGRESO",
        inicio: new Date("2026-08-03T16:30:00-06:00"),
      },
    });

    await ejecutarAutoPausaFinTurno({
      ahora: new Date("2026-08-03T17:45:00-06:00"),
      tipoJornada: "SEMANA",
    });

    const tareaPausada = await prisma.tarea.findUnique({ where: { id: tarea.id } });
    const intervaloCerrado = await prisma.intervaloTiempo.findUnique({ where: { id: intervalo.id } });
    expect(tareaPausada?.estado).toBe("EN_PAUSA");
    expect(tareaPausada?.duracionReal).toBe(60);
    expect(intervaloCerrado?.fin?.toISOString()).toBe("2026-08-03T23:30:00.000Z");
    expect(intervaloCerrado?.duracion).toBe(60);

    await ejecutarAutoPausaFinTurno({
      ahora: new Date("2026-08-03T17:45:00-06:00"),
      tipoJornada: "SEMANA",
    });

    const tareaDespues = await prisma.tarea.findUnique({ where: { id: tarea.id } });
    const historial = await prisma.historialTarea.findMany({ where: { tareaId: tarea.id } });
    expect(tareaDespues?.duracionReal).toBe(60);
    expect(historial.filter((h) => h.nota?.includes("SISTEMA_FIN_TURNO"))).toHaveLength(1);
  });

  // 49. Endpoint heredado de máquina continúa funcionando
  it("49. Endpoint heredado getMaquinaKPIs funciona correctamente", async () => {
    await resetAnalyticData();

    // Crear una tarea resuelta para que el endpoint legacy tenga datos
    await prisma.tarea.create({
      data: {
        titulo: "Legacy Resolved Task",
        descripcion: "Corrective work on machine 1",
        maquinaId: maquina1Id,
        estado: "RESUELTO",
        creadorId: superAdminUser.id,
        clasificacion: "CORRECTIVO",
        tipo: "TICKET",
        duracionReal: 120,
        createdAt: new Date("2026-08-02T10:00:00-06:00"),
      },
    });

    const req = mockReq(superAdminUser, { year: 2026 }, { id: maquina1Id });
    const res = mockRes();
    await getMaquinaKPIs(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.resumen.totalFallas).toBe(1);
    expect(res.body.data.resumen.mttrMinutos).toBe(120);
  });
});
