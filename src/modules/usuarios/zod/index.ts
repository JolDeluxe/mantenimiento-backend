import { z } from "zod";
import { Rol, Estatus } from "@prisma/client";

const rolesArray = Object.values(Rol) as [string, ...string[]];
const estatusArray = Object.values(Estatus) as [string, ...string[]];

export const createUsuarioSchema = z.object({
  body: z.object({
    nombre: z.string().min(3, "El nombre es muy corto"),
    
    // Lógica para email opcional pero validado si existe
    email: z.string()
      .email("Formato de correo inválido")
      .endsWith("@cuadra.com.mx", { message: "Solo se permiten correos corporativos (@cuadra.com.mx)" })
      .or(z.literal("")) // Permite string vacío
      .nullable()        // Permite null
      .optional(),       // Permite undefined

    username: z.string().optional(),
    imagen: z.string().optional(),
    
    password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres"),
    
    rol: z.enum(rolesArray, {
      message: "Rol inválido"
    }).default(Rol.CLIENTE_INTERNO), 

    cargo: z.string().optional(),
    telefono: z.string().optional(),
    departamentoId: z.number().int().nullable().optional(),
  }),
});

export const updateUsuarioSchema = createUsuarioSchema.shape.body.partial(); 

export const patchUsuarioSchema = z.object({
  body: z.object({
    estado: z.enum(estatusArray, {
      message: "El estado solo puede ser ACTIVO o INACTIVO" 
    })
  })
});

export type CreateUsuarioInput = z.infer<typeof createUsuarioSchema>["body"];
export type UpdateUsuarioInput = z.infer<typeof updateUsuarioSchema>;
export type PatchUsuarioInput = z.infer<typeof patchUsuarioSchema>["body"];