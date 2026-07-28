import type { Request, Response } from "express";
import type { z } from "zod";
import { prisma } from "../../../db";
import { registrarError } from "../../../utils/logger";
import { plantillaContenidoSchema } from "./zod";

const KEY_FLAG = "AUTONOMOS_HABILITADOS";

type PlantillaContenido = z.infer<typeof plantillaContenidoSchema>;
type PreguntaCombinada = {
  id: string;
  texto: string;
  orden: number;
  tipoRespuesta: "OK_INCIDENCIA" | "OK_INCIDENCIA_NO_APLICA";
  obligatoria: boolean;
  imagenReferenciaUrl: string | null;
  ayuda: string | null;
  requiereObservacionSi: string[] | null;
  permiteEvidencia: boolean;
};
type SeccionCombinada = {
  id: string;
  titulo: string;
  orden: number;
  templateOrden?: number;
  preguntas: PreguntaCombinada[];
};

export const getAutonomosFormulario = async (req: Request, res: Response) => {
  const rawCodigo = req.query.codigo;
  const codigo = typeof rawCodigo === "string" ? rawCodigo.trim().toUpperCase() : "";

  try {
    // 1. Consultar primero el flag global de autónomos
    const config = await prisma.configuracionSistema.findUnique({
      where: { clave: KEY_FLAG }
    });
    const flagHabilitado = config?.valor === "true";

    // 2. Si está apagado, bloquear el acceso de inmediato sin revelar información
    if (!flagHabilitado) {
      return res.status(403).json({
        error: "El servicio de mantenimiento autónomo no está habilitado."
      });
    }

    // 3. Obtener la máquina junto con las plantillas activas (AUTONOMO o AMBOS)
    const maquina = await prisma.maquina.findUnique({
      where: { codigo },
      select: {
        codigo: true,
        nombre: true,
        plantillasRevision: {
          where: {
            activa: true,
            plantilla: {
              activa: true,
              aplicaA: {
                in: ["AUTONOMO", "AMBOS"]
              }
            }
          },
          orderBy: {
            orden: "asc"
          },
          select: {
            orden: true,
            plantilla: {
              select: {
                id: true,
                nombre: true,
                contenido: true
              }
            }
          }
        }
      }
    });

    if (!maquina) {
      return res.status(404).json({
        error: "Este código no corresponde a un equipo registrado."
      });
    }

    // 4. Si la máquina no tiene plantillas asignadas activas
    if (maquina.plantillasRevision.length === 0) {
      return res.status(404).json({
        error: "El equipo no tiene configurado ningún formulario de mantenimiento autónomo."
      });
    }

    // 5. Validar y combinar las plantillas
    const combinedSecciones: SeccionCombinada[] = [];

    for (const pr of maquina.plantillasRevision) {
      const plantilla = pr.plantilla;
      let parsedContenido: PlantillaContenido;

      try {
        parsedContenido = plantillaContenidoSchema.parse(plantilla.contenido);
      } catch (err) {
        // En caso de JSON corrupto o inválido, registrar error y fallar controladamente
        await registrarError(`JSON_INVALID_TEMPLATE_ID_${plantilla.id}`, null, err);
        return res.status(500).json({
          error: "Error interno al procesar las plantillas del equipo."
        });
      }

      // Procesar secciones sin mutar el original
      for (const seccion of parsedContenido.secciones) {
        const uniqueSeccionId = `p${plantilla.id}_s${seccion.id}`;
        
        const mappedPreguntas = seccion.preguntas.map((preg) => ({
          id: `p${plantilla.id}_q${preg.id}`,
          texto: preg.texto,
          orden: preg.orden,
          tipoRespuesta: preg.tipoRespuesta,
          obligatoria: preg.obligatoria,
          imagenReferenciaUrl: preg.imagenReferenciaUrl || null,
          ayuda: preg.ayuda || null,
          requiereObservacionSi: preg.requiereObservacionSi || null,
          permiteEvidencia: preg.permiteEvidencia ?? false
        }));

        combinedSecciones.push({
          id: uniqueSeccionId,
          titulo: `${seccion.titulo} (${plantilla.nombre})`,
          orden: seccion.orden,
          templateOrden: pr.orden,
          preguntas: mappedPreguntas
        });
      }
    }

    // Ordenar secciones: por orden de la sección, luego por orden de asignación de plantilla
    combinedSecciones.sort((a, b) => {
      if (a.orden !== b.orden) {
        return a.orden - b.orden;
      }
      return (a.templateOrden ?? 0) - (b.templateOrden ?? 0);
    });

    // Ordenar preguntas de cada sección
    for (const sec of combinedSecciones) {
      sec.preguntas.sort((a, b) => a.orden - b.orden);
      // Eliminar templateOrden del payload final para mantenerlo limpio
      delete sec.templateOrden;
    }

    // 6. Retornar payload limpio
    return res.status(200).json({
      maquina: {
        codigo: maquina.codigo,
        nombre: maquina.nombre
      },
      formulario: {
        secciones: combinedSecciones
      }
    });

  } catch (error) {
    await registrarError("GET_AUTONOMOS_FORMULARIO", null, error);
    return res.status(500).json({
      error: "Error interno al procesar la solicitud del formulario."
    });
  }
};
