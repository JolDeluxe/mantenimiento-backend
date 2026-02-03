// import { type Request, type Response } from "express";
// import { prisma } from "../../db";
// import { generarUsername } from "../utils/userGenerator";
// import { Estatus } from "@prisma/client";

// export const crearUsuario = async (req: Request, res: Response) => {
//   try {
//     const { nombre, email, password, rol, departamentoId, cargo, numNomina } = req.body;

//     // 1. Generar Username Automático
//     let username = generarUsername(nombre);

//     // 2. Verificar si el username ya existe y agregar sufijo si es necesario
//     let counter = 1;
//     while (await prisma.usuario.findUnique({ where: { username } })) {
//       username = `${generarUsername(nombre)}${counter}`;
//       counter++;
//     }

//     // 3. Hash Password
//     const hashedPassword = await Bun.password.hash(password);

//     // 4. Crear Usuario
//     const nuevoUsuario = await prisma.usuario.create({
//       data: {
//         nombre,
//         username, // <--- Aquí se guarda el generado
//         email: email || null, // Permite nulos para Técnicos
//         password: hashedPassword,
//         rol,
//         estado: Estatus.ACTIVO,
//         departamentoId: departamentoId || null,
//         cargo: cargo || null,
//         numNomina: numNomina || null
//       }
//     });

//     return res.status(201).json({
//       status: "success",
//       message: "Usuario creado correctamente",
//       data: {
//         id: nuevoUsuario.id,
//         username: nuevoUsuario.username, // Devolvemos el username generado
//         rol: nuevoUsuario.rol
//       }
//     });

//   } catch (error) {
//     console.error("Error al crear usuario:", error);
//     return res.status(500).json({ status: "error", message: "Error interno al crear usuario" });
//   }
// };