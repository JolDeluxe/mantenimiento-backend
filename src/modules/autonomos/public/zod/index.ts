import { z } from "zod";

const SAFE_ID_REGEX = /^[A-Za-z0-9_-]+$/;
const SAFE_INTERNAL_IMAGE_PATH_REGEX = /^\/(?:imagenes|img)\/[A-Za-z0-9/_-]+\.(?:png|jpg|jpeg|webp)$/i;

const respuestaPermitidaSchema = z.enum(["OK", "INCIDENCIA", "NO_APLICA"]);
const tipoRespuestaSchema = z.enum(["OK_INCIDENCIA", "OK_INCIDENCIA_NO_APLICA"]);

const safeIdSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(SAFE_ID_REGEX, "El id contiene caracteres no permitidos");

const imagenReferenciaUrlSchema = z.string()
  .trim()
  .max(500)
  .refine((value) => {
    if (SAFE_INTERNAL_IMAGE_PATH_REGEX.test(value)) {
      return true;
    }

    try {
      const url = new URL(value);
      return url.protocol === "https:";
    } catch {
      return false;
    }
  }, "La imagen de referencia debe ser HTTPS o una ruta interna segura")
  .nullable()
  .optional();

export const gatewayQuerySchema = z.object({
  query: z.object({
    codigo: z.string()
      .trim()
      .toUpperCase()
      .min(1, "El código de máquina es requerido")
      .max(50, "El código debe tener como máximo 50 caracteres")
      .regex(/^[A-Z0-9_-]+$/, "El código tiene caracteres no permitidos")
  })
});

export const plantillaContenidoSchema = z.object({
  schemaVersion: z.literal(1),
  titulo: z.string().trim().min(1).max(160),
  instrucciones: z.string().trim().max(1000).optional(),
  secciones: z.array(
    z.object({
      id: safeIdSchema,
      titulo: z.string().trim().min(1).max(160),
      orden: z.number().int().nonnegative(),
      preguntas: z.array(
        z.object({
          id: safeIdSchema,
          texto: z.string().trim().min(1).max(500),
          orden: z.number().int().nonnegative(),
          tipoRespuesta: tipoRespuestaSchema,
          obligatoria: z.boolean(),
          imagenReferenciaUrl: imagenReferenciaUrlSchema,
          ayuda: z.string().trim().max(500).nullable().optional(),
          requiereObservacionSi: z.array(respuestaPermitidaSchema).max(3).nullable().optional(),
          permiteEvidencia: z.boolean()
        }).strict()
      ).min(1).max(80)
    }).strict()
  ).min(1).max(30)
}).strict().superRefine((plantilla, ctx) => {
  const seccionIds = new Set<string>();
  const preguntaIds = new Set<string>();

  plantilla.secciones.forEach((seccion, seccionIndex) => {
    if (seccionIds.has(seccion.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["secciones", seccionIndex, "id"],
        message: "El id de sección está duplicado dentro de la plantilla"
      });
    }
    seccionIds.add(seccion.id);

    seccion.preguntas.forEach((pregunta, preguntaIndex) => {
      if (preguntaIds.has(pregunta.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["secciones", seccionIndex, "preguntas", preguntaIndex, "id"],
          message: "El id de pregunta está duplicado dentro de la plantilla"
        });
      }
      preguntaIds.add(pregunta.id);

      const respuestasDisponibles = pregunta.tipoRespuesta === "OK_INCIDENCIA"
        ? ["OK", "INCIDENCIA"]
        : ["OK", "INCIDENCIA", "NO_APLICA"];

      for (const respuesta of pregunta.requiereObservacionSi ?? []) {
        if (!respuestasDisponibles.includes(respuesta)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["secciones", seccionIndex, "preguntas", preguntaIndex, "requiereObservacionSi"],
            message: "La observación requerida no es compatible con el tipo de respuesta"
          });
        }
      }
    });
  });
});
