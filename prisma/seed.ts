import { PrismaClient, Rol } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  
  console.log('🌱 Iniciando proceso de Seed...');
  console.log(`Ambiente: ${isProduction ? 'PRODUCCIÓN 🔴' : 'DESARROLLO 🟢'}`);

  if (isProduction) {
    console.log('✅ En producción, la integridad base la maneja setup.ts.');
    console.log('🏁 Seed finalizado sin cambios adicionales.');
    return;
  }

  // --- DATOS EXCLUSIVOS PARA DESARROLLO / PRUEBAS ---
  console.log('🧪 Inyectando catálogos de prueba para desarrollo...');

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('123456', salt);

  const NAME_MTTO = 'Mantenimiento';
  const NAME_PROCESOS = 'Procesos Tecnológicos';
  const NAME_CORTE = 'Corte';

  // 2. CORRECCIÓN: Usamos strings directos ("KAPPA", "OPERATIVO")
  const departamentosData = [
    // --- OMEGA ---
    { nombre: 'PT Omega', planta: "OMEGA", tipo: "OPERATIVO" },

    // --- SIGMA ---
    { nombre: 'Preliminares Sigma', planta: "SIGMA", tipo: "OPERATIVO" }, 
    { nombre: 'Laser y Bordado Sigma', planta: "SIGMA", tipo: "OPERATIVO" },

    // --- LAMBDA ---
    { nombre: 'Bolsas y Billeteras', planta: "LAMBDA", tipo: "OPERATIVO" },

    // --- KAPPA (Operativos) ---
    { nombre: 'Acabado', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Almacén de Materia Prima', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Almacén de Pieles', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Bordado Kappa', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Calidad', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Célula Desarrollo', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Chamarras', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Cintos', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: NAME_CORTE, planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Laser Kappa', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Pespunte', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Montado', planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: 'Preliminares Kappa', planta: "KAPPA", tipo: "OPERATIVO" },

    // --- KAPPA (Administrativos) ---
    { nombre: 'Administración', planta: "KAPPA", tipo: "ADMINISTRATIVO" },
    { nombre: 'Capital Humano', planta: "KAPPA", tipo: "ADMINISTRATIVO" },
    { nombre: 'Imagen y Diseño', planta: "KAPPA", tipo: "ADMINISTRATIVO" },
    { nombre: 'Calidad - Oficinas', planta: "KAPPA", tipo: "ADMINISTRATIVO" },
    
    // --- DEPARTAMENTOS CLAVE ---
    { nombre: NAME_MTTO, planta: "KAPPA", tipo: "OPERATIVO" },
    { nombre: NAME_PROCESOS, planta: "KAPPA", tipo: "ADMINISTRATIVO" },
  ];

  // Insertar Departamentos
  for (const depto of departamentosData) {
    await prisma.departamento.upsert({
      where: { nombre: depto.nombre },
      update: { planta: depto.planta, tipo: depto.tipo },
      create: depto
    });
  }
  console.log('✅ Departamentos insertados/actualizados.');

  // --- 3. OBTENER IDs ---
  console.log('🔍 Buscando IDs de departamentos clave...');
  
  const deptoMantenimiento = await prisma.departamento.findUnique({ where: { nombre: NAME_MTTO } });
  const deptoProcesos = await prisma.departamento.findUnique({ where: { nombre: NAME_PROCESOS } });
  const deptoCorte = await prisma.departamento.findUnique({ where: { nombre: NAME_CORTE } });

  if (!deptoMantenimiento) throw new Error(`❌ ERROR CRÍTICO: No se encontró el departamento '${NAME_MTTO}' en la BD.`);
  if (!deptoProcesos) throw new Error(`❌ ERROR CRÍTICO: No se encontró el departamento '${NAME_PROCESOS}' en la BD.`);

  console.log(`   -> ID Mantenimiento: ${deptoMantenimiento.id}`);
  console.log(`   -> ID Procesos: ${deptoProcesos.id}`);

  // --- 4. USUARIOS ---
  console.log('👥 Creando Usuarios...');

  const usuariosData = [
    // 1. CLIENTE (Joel)
    {
      username: 'jrodriguez',
      email: 'coordinador.procesostecnologicos@cuadra.com.mx',
      nombre: 'Joel Rodríguez',
      password: hash,
      rol: Rol.CLIENTE_INTERNO,
      cargo: 'Coordinador Procesos',
      departamentoId: deptoProcesos.id
    },
    // 2. JEFE MANTENIMIENTO (Juan Carlos)
    {
      username: 'jvillegas',
      email: 'admin@cuadra.com.mx',
      nombre: 'Juan Carlos Villegas',
      password: hash,
      rol: Rol.JEFE_MTTO, 
      cargo: 'Jefe de Mantenimiento',
      departamentoId: deptoMantenimiento.id
    },
    // 3. COORDINADOR 
    {
      username: 'mhernandez',
      email: 'coordinador@cuadra.com.mx',
      nombre: 'Miguel Hernández',
      password: hash,
      rol: Rol.COORDINADOR_MTTO,
      cargo: 'Coordinador Turno 1',
      departamentoId: deptoMantenimiento.id
    },
    // 4. TECNICO 
    {
      username: 'llopez',
      email: 'tecnico1@cuadra.com.mx',
      nombre: 'Luis López',
      password: hash,
      rol: Rol.TECNICO,
      cargo: 'Técnico General',
      departamentoId: deptoMantenimiento.id
    },
    // 5. CLIENTE (Operativo)
    {
      username: 'agarcia',
      email: 'cliente@cuadra.com.mx',
      nombre: 'Ana García',
      password: hash,
      rol: Rol.CLIENTE_INTERNO,
      cargo: 'Supervisor Corte',
      departamentoId: deptoCorte?.id 
    }
  ];
 
  for (const user of usuariosData) {
    if (!user.departamentoId) {
      // Si el deptoCorte no existe (es undefined), avisamos pero no tronamos el script
      console.warn(`⚠️ ALERTA: Saltando creación de ${user.nombre} porque su departamento no tiene ID válido.`);
      continue; 
    }

    const usuarioCreado = await prisma.usuario.upsert({
      where: { username: user.username },
      update: {
        password: user.password,
        rol: user.rol,
        email: user.email,
        departamentoId: user.departamentoId
      },
      create: {
        username: user.username,
        email: user.email,
        nombre: user.nombre,
        password: user.password,
        rol: user.rol,
        cargo: user.cargo,
        departamentoId: user.departamentoId
      }
    });
    console.log(`   -> Usuario listo: ${usuarioCreado.username} (${usuarioCreado.rol})`);
  }

  console.log('✅ Usuarios listos.');
  console.log('🏁 Seed completado con éxito.');
}

main()
  .catch((e) => {
    console.error('❌ Error fatal en el seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });