Backend - Sistema de Mantenimiento Cuadra
Este es el núcleo del sistema de gestión de mantenimiento, construido con Bun, Express y Prisma.

🚀 Tecnologías Principales
Runtime: Bun (Fast JavaScript all-in-one toolkit)

Lenguaje: TypeScript (ESNext)

Framework: Express 5

ORM: Prisma (MySQL)

Validación: Zod

Servicios: Cloudinary (Imágenes), Nodemailer (Correos)

🛠️ Requisitos Previos
Tener instalado Bun ( curl -fsSL https://bun.sh/install | bash ).

Base de datos MySQL activa.

⚙️ Configuración del Entorno
El archivo .env es obligatorio para el funcionamiento del servidor. Crea uno en la raíz basándote en el siguiente esquema:

Bash
# Servidor
PORT=3000
NODE_ENV="development"

# Base de Datos
DATABASE_URL="mysql://USUARIO:PASSWORD@localhost:3306/mantenimiento"

# Autenticación
JWT_SECRET="tu_llave_secreta_aqui"
JWT_EXPIRES="1y"

# Configuración de Sistema
SYS_DEPTO_CRITICO="Mantenimiento"
SYS_ADMIN_USER="ADMIN_NAME"
SYS_ADMIN_PASS="ADMIN_PASS"

# Cloudinary (Multimedia)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
🏗️ Instalación y Ejecución
Instalar dependencias:

Bash
bun install
Configurar base de datos (Prisma):

Bash
bunx prisma generate
bunx prisma db push
Poblar base de datos (Seed):

Bash
bun run db-seed
Iniciar en modo desarrollo:

Bash
bun dev
Compilar (Build):

Bash
bun run build
📂 Estructura de Scripts
dev: Ejecuta el servidor con hot-reload usando el observador nativo de Bun.

start: Ejecuta el servidor en entorno de producción.

db-seed: Ejecuta el script de carga inicial de datos (usuarios admin, catálogos, etc.).

🔒 Seguridad y Buenas Prácticas
Validación: Todas las entradas de API se validan con esquemas de Zod.

Logs: Se utiliza Morgan para el rastreo de peticiones en consola.

Tareas programadas: El sistema utiliza node-cron para procesos automáticos de mantenimiento.
