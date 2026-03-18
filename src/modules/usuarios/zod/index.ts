import { z } from "zod";
import { Rol, Estatus } from "@prisma/client";

const rolesArray = Object.values(Rol) as [string, ...string[]];
const estatusArray = Object.values(Estatus) as [string, ...string[]];

export const listUsuariosSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    limit: z.coerce.number().min(1).max(100).default(20),
    rol: z.enum(rolesArray).optional(),
    estado: z.enum(estatusArray).optional(),
    departamentoId: z.coerce.number().int().positive().optional(),
    mtto: z.preprocess(
      (val) => val === 'true' || val === true || val === '1',
      z.boolean().optional()
    ),
    sort: z.preprocess(
      (val) => {
        if (typeof val === "string") {
          try { return JSON.parse(val); } catch { return []; }
        }
        return val;
      },
      z.array(
        z.object({
          nombre:      z.enum(["asc", "desc"]).optional(),
          username:    z.enum(["asc", "desc"]).optional(),
          email:       z.enum(["asc", "desc"]).optional(),
          rol:         z.enum(["asc", "desc"]).optional(),
          createdAt:   z.enum(["asc", "desc"]).optional(),
          updatedAt:   z.enum(["asc", "desc"]).optional(),
          departamento:z.enum(["asc", "desc"]).optional(),
        }).strict()
      )
    ).default([{ nombre: "asc" }]),
  }),
});

export const getUsuarioByIdSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
});

export const createUsuarioSchema = z.object({
  body: z.object({
    nombre: z.string().min(3, "El nombre es muy corto"),
    
    email: z.preprocess(
      (val) => (val === "null" || val === "" ? null : val),
      z.string()
        .email("Formato de correo inválido")
        .endsWith("@cuadra.com.mx", { message: "Solo se permiten correos corporativos (@cuadra.com.mx)" })
        .nullable()
        .optional()
    ),

    username: z.string().optional(),

    imagen: z.preprocess(
      (val) => {
        if (val === "null" || val === "") return null;
        // Si el payload es un archivo físico (FormData), lo volvemos undefined 
        // para que Zod lo deje pasar gracias al .optional(), ya que multer usará req.file
        if (typeof val === "object" || val === "[object File]" || val === "[object Object]") return undefined;
        return val;
      },
      z.string().nullable().optional()
    ),
    
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    
    rol: z.enum(rolesArray, { message: "Rol inválido" }).default(Rol.CLIENTE_INTERNO), 

    cargo: z.string().optional(),
    
    // Si envían texto vacío "", lo transformamos en NULL para la Base de Datos
    telefono: z.preprocess(
      (val) => (val === "null" || val === "" ? null : val),
      z.string().nullable().optional()
    ),
    
    departamentoId: z.preprocess(
      (val) => {
        if (val === "null" || val === "") return null;
        if (typeof val === "string") return Number(val);
        return val;
      },
      z.number().int().positive().nullable().optional()
    ),
  }),
});

export const updateUsuarioSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    nombre: z.string().min(3, "El nombre es muy corto").optional(),
    
    username: z.string().optional(),
    
    email: z.preprocess(
      (val) => (val === "null" || val === "" ? null : val),
      z.string()
        .email("Formato de correo inválido")
        .endsWith("@cuadra.com.mx", { message: "Solo se permiten correos corporativos (@cuadra.com.mx)" })
        .nullable()
        .optional()
    ),

    imagen: z.preprocess(
      (val) => (val === "null" || val === "" ? null : val),
      z.string().nullable().optional()
    ),
    
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional(),
    
    rol: z.enum(rolesArray, { message: "Rol inválido" }).optional(), 
    
    cargo: z.string().optional(),
    estado: z.enum(estatusArray, { message: "Estado inválido" }).optional(),
    
    // 🔥 CORRECCIÓN: Aplicado también en la Actualización
    telefono: z.preprocess(
      (val) => (val === "" || val === "null" ? null : val),
      z.string().nullable().optional()
    ),
    
    departamentoId: z.preprocess(
      (val) => {
        if (val === "" || val === "null" || val === null) return null;
        if (val !== undefined) return Number(val);
        return undefined;
      }, 
      z.number().int().positive().nullable().optional()
    ),
  }).strict()
});

export const patchUsuarioSchema = z.object({
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  body: z.object({
    estado: z.enum(estatusArray, { message: "El estado solo puede ser ACTIVO o INACTIVO" })
  })
});

// --- INFERENCIAS ---
export type ListUsuariosQuery = z.infer<typeof listUsuariosSchema>["query"];
export type GetUsuarioByIdParams = z.infer<typeof getUsuarioByIdSchema>["params"];
export type CreateUsuarioInput = z.infer<typeof createUsuarioSchema>["body"];
export type UpdateUsuarioParams = z.infer<typeof updateUsuarioSchema>["params"];
export type UpdateUsuarioInput = z.infer<typeof updateUsuarioSchema>["body"];
export type PatchUsuarioParams = z.infer<typeof patchUsuarioSchema>["params"];
export type PatchUsuarioInput = z.infer<typeof patchUsuarioSchema>["body"];