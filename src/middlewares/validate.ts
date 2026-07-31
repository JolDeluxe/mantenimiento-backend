import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

/**
 * Middleware de validación centralizado para el ecosistema CUADRA.
 * Blindado para soportar JSON y FormData (Multipart).
 */
export const validate = (schema: ZodSchema) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    // 1. LIMPIEZA PRE-VALIDACIÓN (Especial para FormData)
    // Cuando el frontend envía FormData, Multer inyecta strings en req.body.
    // Convertimos "null", "undefined" o "" en null real para que Zod pueda validarlos.
    const cleanBody = req.body ? Object.fromEntries(
      Object.entries(req.body).map(([key, value]) => [
        key, 
        value === "" || value === "null" || value === "undefined" ? null : value
      ])
    ) : req.body;

    // 2. PROCESAMIENTO CON ZOD
    // Parseamos body, query y params simultáneamente.
    // Zod aplicará coerce, default y preprocess definidos en el módulo.
    const validatedData = await schema.parseAsync({
      body: cleanBody,
      query: req.query,
      params: req.params,
    }) as Record<string, any>;

    // 3. REASIGNACIÓN BLINDADA (Shadowing)
    // Matamos los getters nativos de Express para evitar que los datos originales
    // (sucios) se filtren a los controladores.
    if (validatedData.body !== undefined) {
      Object.defineProperty(req, "body", {
        value: validatedData.body,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (validatedData.query !== undefined) {
      Object.defineProperty(req, "query", {
        value: validatedData.query,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (validatedData.params !== undefined) {
      Object.defineProperty(req, "params", {
        value: validatedData.params,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    return next();
  } catch (error: any) {
    // 4. MANEJO UNIFORME DE ERRORES DE VALIDACIÓN
    // Soporta duck typing para compatibilidad total con el runtime Bun.
    if (error instanceof ZodError || error?.name === "ZodError") {
      return res.status(400).json({
        status: "error",
        message: "Datos de entrada inválidos",
        error: "Datos de entrada inválidos",
        errors: error.issues.map((issue: any) => ({
          field: issue.path.join("."), 
          message: issue.message,
        })),
        details: error.issues.map((issue: any) => ({
          path: issue.path.filter((p: any) => p !== "body" && p !== "query" && p !== "params"),
          message: issue.message,
        })),
      });
    }
    
    // Fallback para errores imprevistos del sistema
    console.error("🔥 Error Crítico en Middleware de Validación:", error);
    return res.status(500).json({ 
      error: "Error interno durante la validación de la solicitud" 
    });
  }
};