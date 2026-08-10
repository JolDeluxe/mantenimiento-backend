module.exports = {
  apps: [
    {
      name: "mantenimiento-api",
      // Ruta absoluta al ejecutable real de Bun (evita wrappers .cmd)
      script: "C:\\Users\\CUADRA\\AppData\\Roaming\\npm\\node_modules\\bun\\bin\\bun.exe",
      // Argumentos para que Bun ejecute el punto de entrada
      args: "run src/index.ts",
      // Le decimos a PM2 que no use ningún intérprete externo (ya definimos el exe arriba)
      interpreter: "none",
      exec_mode: "fork",
      shutdown_with_message: true,
      watch: false,
      env_production: {
        NODE_ENV: "production",
      },
      // Gestión de resiliencia
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 8000,
      // Registro de eventos del sistema
      out_file: "./logs/out.log",
      error_file: "./logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
