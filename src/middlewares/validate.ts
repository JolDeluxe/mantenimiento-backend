import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

export const validate = (schema: ZodSchema) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validamos el objeto completo (extrae los defaults, limpia arreglos, fechas, etc.)
    const validatedData = await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    }) as Record<string, any>;

    // REASIGNACIÓN BLINDADA (Shadowing)
    // Usamos defineProperty para matar los "Getters" nativos de Express y forzar 
    // a que req.query, req.body y req.params sean nuestros objetos validados estáticos.

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
    // Duck typing: Asegura compatibilidad en Bun / Monorepos
    if (error instanceof ZodError || error?.name === "ZodError") {
      return res.status(400).json({
        status: "error",
        message: "Datos de entrada inválidos",
        errors: error.issues.map((issue: any) => ({
          field: issue.path.join("."), 
          message: issue.message,
        })),
      });
    }
    
    // Fallback real de servidor
    console.error("🔥 Error Crítico en Validación:", error);
    return res.status(500).json({ error: "Error interno de validación" });
  }
};