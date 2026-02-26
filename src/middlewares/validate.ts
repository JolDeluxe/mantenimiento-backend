import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

export const validate = (schema: ZodSchema) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Validamos el objeto completo
    const validatedData = await schema.parseAsync({
      body: req.body,
      query: req.query,
      params: req.params,
    }) as Record<string, any>;

    // Reasignación segura
    // Evita sobrescribir con undefined si el esquema original no incluía esa sección
    if (validatedData.body !== undefined) req.body = validatedData.body;
    if (validatedData.query !== undefined) req.query = validatedData.query;
    if (validatedData.params !== undefined) req.params = validatedData.params;

    return next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({
        status: "error",
        message: "Datos de entrada inválidos",
        errors: error.issues.map((issue) => ({
          field: issue.path.join("."), 
          message: issue.message,
        })),
      });
    }
    return res.status(500).json({ error: "Error interno de validación" });
  }
};