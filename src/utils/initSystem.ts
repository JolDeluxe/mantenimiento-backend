import { prisma } from "../db"; 
import { Rol } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../env"; 


export const inicializarSistema = async () => {
  console.log("⚙️  Verificando integridad del sistema...");

  try {
    const depto = await prisma.departamento.upsert({
      where: { nombre: env.SYS_DEPTO_CRITICO },
      update: {
        planta: "KAPPA",
        tipo: "OPERATIVO"
      },
      create: {
        nombre: env.SYS_DEPTO_CRITICO,
        planta: "KAPPA",
        tipo: "OPERATIVO"
      }
    });
    console.log(`✅ Departamento Crítico verificado: ${depto.nombre}`);

    const hashedPassword = await bcrypt.hash(env.SYS_ADMIN_PASS, 10);

    const superAdmin = await prisma.usuario.upsert({
      where: { username: env.SYS_ADMIN_USER },
      update: {
        rol: Rol.SUPER_ADMIN,
        departamentoId: null,
      },
      create: {
        nombre: "Administrador del Sistema",
        username: env.SYS_ADMIN_USER,
        email: null,
        password: hashedPassword,
        rol: Rol.SUPER_ADMIN,
        cargo: "Super Admin",
        departamentoId: null
      }
    });

    console.log(`✅ Super Admin verificado: ${superAdmin.username} (ID: ${superAdmin.id})`);

  } catch (error) {
    console.error("🔥 ERROR CRÍTICO al inicializar el sistema:", error);
    process.exit(1); 
  }
};