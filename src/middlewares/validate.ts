import { type Request, type Response, type NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

export const validate =
  (schema: ZodSchema) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          status: "bad_request",
          errors: error.issues.map((issue) => ({
            field: issue.path[1] || issue.path[0], 
            message: issue.message,
          })),
        });
      }
      return res.status(500).json({ error: "Error interno de validación" });
    }
  };