import { prisma } from "../src/db";

const TEST_MACHINE_CODES = ["TEST_M1", "TEST_M2", "TEST_M3"] as const;
const TEST_TEMPLATE_NAMES = [
  "TEST_PLANTILLA_AUTONOMO_A",
  "TEST_PLANTILLA_AUTONOMO_B",
  "TEST_PLANTILLA_PREVENTIVO",
  "TEST_PLANTILLA_INACTIVA"
] as const;
const AUTONOMOS_FLAG_KEY = "AUTONOMOS_HABILITADOS";
const CONFIRM_ARG = "--confirm-development";

type TestTemplateName = (typeof TEST_TEMPLATE_NAMES)[number];

const assertDevelopmentExecution = () => {
  if (process.env.NODE_ENV !== "development") {
    throw new Error("Este seed requiere NODE_ENV=development.");
  }

  if (!process.argv.includes(CONFIRM_ARG)) {
    throw new Error(`Este seed requiere el argumento explícito ${CONFIRM_ARG}.`);
  }
};

const forceAutonomosFlagOff = async () => {
  await prisma.configuracionSistema.upsert({
    where: { clave: AUTONOMOS_FLAG_KEY },
    update: {
      valor: "false",
      descripcion: "Habilita el gateway público de mantenimiento autónomo."
    },
    create: {
      clave: AUTONOMOS_FLAG_KEY,
      valor: "false",
      descripcion: "Habilita el gateway público de mantenimiento autónomo."
    }
  });
};

const upsertTestTemplate = async (nombre: TestTemplateName, data: {
  descripcion: string;
  aplicaA: "AUTONOMO" | "PREVENTIVO" | "AMBOS";
  activa: boolean;
  contenido: object;
}) => {
  const existing = await prisma.plantillaRevision.findFirst({
    where: { nombre },
    select: { id: true }
  });

  if (existing) {
    return prisma.plantillaRevision.update({
      where: { id: existing.id },
      data
    });
  }

  return prisma.plantillaRevision.create({
    data: {
      nombre,
      ...data
    }
  });
};

const upsertTestMachine = async (codigo: (typeof TEST_MACHINE_CODES)[number], data: {
  nombre: string;
  estado: "OPERATIVO";
  criticidad: "ALTA" | "MEDIA" | "CRITICA";
  proceso: string;
  area: string;
  planta: string;
}) => {
  return prisma.maquina.upsert({
    where: { codigo },
    update: data,
    create: {
      codigo,
      ...data
    }
  });
};

const upsertAssignment = async (maquinaId: number, plantillaId: number, orden: number, activa: boolean) => {
  return prisma.plantillaRevisionMaquina.upsert({
    where: {
      plantillaId_maquinaId: {
        plantillaId,
        maquinaId
      }
    },
    update: {
      orden,
      activa
    },
    create: {
      maquinaId,
      plantillaId,
      orden,
      activa
    }
  });
};

async function main() {
  assertDevelopmentExecution();

  console.log("--- SEMBRANDO DATOS DE PRUEBA CONTROLADOS PARA ETAPA 3 ---");

  const plantillaAutonomoA = await upsertTestTemplate("TEST_PLANTILLA_AUTONOMO_A", {
    descripcion: "Inspección básica de limpieza y lubricación",
    aplicaA: "AUTONOMO",
    activa: true,
    contenido: {
      schemaVersion: 1,
      titulo: "Inspección de Filtros y Fugas",
      secciones: [
        {
          id: "S1",
          titulo: "Filtros de Aire",
          orden: 1,
          preguntas: [
            {
              id: "Q1",
              texto: "¿El filtro de aire principal está limpio y libre de polvo?",
              orden: 1,
              tipoRespuesta: "OK_INCIDENCIA",
              obligatoria: true,
              permiteEvidencia: true,
              requiereObservacionSi: ["INCIDENCIA"],
              ayuda: "Retire el filtro y sople con aire comprimido levemente si es necesario",
              imagenReferenciaUrl: null
            }
          ]
        }
      ]
    }
  });

  const plantillaAutonomoB = await upsertTestTemplate("TEST_PLANTILLA_AUTONOMO_B", {
    descripcion: "Inspección de sistemas eléctricos y de seguridad",
    aplicaA: "AUTONOMO",
    activa: true,
    contenido: {
      schemaVersion: 1,
      titulo: "Sistemas de Seguridad",
      secciones: [
        {
          id: "S1",
          titulo: "Botones de Parada",
          orden: 2,
          preguntas: [
            {
              id: "Q1",
              texto: "¿El botón de parada de emergencia funciona correctamente?",
              orden: 1,
              tipoRespuesta: "OK_INCIDENCIA_NO_APLICA",
              obligatoria: true,
              permiteEvidencia: false,
              imagenReferenciaUrl: "/imagenes/emergencia_ref.png",
              ayuda: "Presione el botón y verifique el corte de energía instantáneo",
              requiereObservacionSi: ["INCIDENCIA"]
            }
          ]
        }
      ]
    }
  });

  const plantillaPreventivo = await upsertTestTemplate("TEST_PLANTILLA_PREVENTIVO", {
    descripcion: "Plantilla preventiva de instrumentación técnica",
    aplicaA: "PREVENTIVO",
    activa: true,
    contenido: {
      schemaVersion: 1,
      titulo: "Calibración Frecuente",
      secciones: [
        {
          id: "S1",
          titulo: "Presión del Manómetro",
          orden: 1,
          preguntas: [
            {
              id: "Q1",
              texto: "¿El manómetro indica 0 psi en reposo?",
              orden: 1,
              tipoRespuesta: "OK_INCIDENCIA",
              obligatoria: true,
              permiteEvidencia: false,
              imagenReferenciaUrl: null,
              ayuda: null,
              requiereObservacionSi: ["INCIDENCIA"]
            }
          ]
        }
      ]
    }
  });

  const plantillaInactiva = await upsertTestTemplate("TEST_PLANTILLA_INACTIVA", {
    descripcion: "Plantilla inactiva",
    aplicaA: "AUTONOMO",
    activa: true,
    contenido: {
      schemaVersion: 1,
      titulo: "Plantilla inactiva",
      secciones: [
        {
          id: "S1",
          titulo: "No visible",
          orden: 1,
          preguntas: [
            {
              id: "Q1",
              texto: "Esta pregunta no debe mostrarse por asignación inactiva.",
              orden: 1,
              tipoRespuesta: "OK_INCIDENCIA",
              obligatoria: true,
              permiteEvidencia: false,
              imagenReferenciaUrl: null,
              ayuda: null,
              requiereObservacionSi: ["INCIDENCIA"]
            }
          ]
        }
      ]
    }
  });

  const maquina1 = await upsertTestMachine("TEST_M1", {
    nombre: "PRENSA HIDRAULICA TEST 1",
    estado: "OPERATIVO",
    criticidad: "ALTA",
    proceso: "ESTAMPADO",
    area: "TEST_AREA",
    planta: "KAPPA"
  });

  await upsertTestMachine("TEST_M2", {
    nombre: "TORNO CNC TEST 2",
    estado: "OPERATIVO",
    criticidad: "MEDIA",
    proceso: "MAQUINADO",
    area: "TEST_AREA",
    planta: "KAPPA"
  });

  const maquina3 = await upsertTestMachine("TEST_M3", {
    nombre: "COMPRESOR DE AIRE TEST 3",
    estado: "OPERATIVO",
    criticidad: "CRITICA",
    proceso: "SERVICIOS",
    area: "TEST_AREA",
    planta: "KAPPA"
  });

  await upsertAssignment(maquina1.id, plantillaAutonomoA.id, 1, true);
  await upsertAssignment(maquina3.id, plantillaAutonomoA.id, 1, true);
  await upsertAssignment(maquina3.id, plantillaAutonomoB.id, 2, true);
  await upsertAssignment(maquina3.id, plantillaPreventivo.id, 3, true);
  await upsertAssignment(maquina3.id, plantillaInactiva.id, 4, false);

  console.log("DATOS_TEST_AUTONOMOS_OK");
  console.log(`MAQUINAS=${TEST_MACHINE_CODES.join(",")}`);
  console.log(`PLANTILLAS=${TEST_TEMPLATE_NAMES.join(",")}`);
}

main()
  .catch((err) => {
    console.error("Error al sembrar datos de prueba de autónomos:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await forceAutonomosFlagOff().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    console.log("AUTONOMOS_HABILITADOS=false");
  });
