# Scripts manuales

Esta carpeta queda solo para scripts manuales seguros.

## Ingesta maquinaria CSV oficial

Preview sin escribir:

```bash
bun src/test/test_ingesta_csv.ts
```

Aplicar cambios reales:

```bash
bun src/test/test_ingesta_csv.ts --apply
```

Usar archivo especifico:

```bash
bun src/test/test_ingesta_csv.ts --file="C:/ruta/Maquinaria.csv"
```

La ruta oficial debe configurarse en `.env`:

```env
MAQUINARIA_CSV_FILE_PATH="C:/ruta/Maquinaria.csv"
```

## Correo dev

Crear cuenta Ethereal para pruebas locales:

```bash
bun src/test/setup_dev_mail.ts
```

## Depuracion hecha

Se retiraron seeds y pruebas antiguas que escribian datos directo, usaban tokens/passwords hardcodeados o dependian de archivos locales inexistentes.

## Scripts de Importación

Recientemente se movieron a esta carpeta los scripts utilizados para importar actividades y tickets correctivos masivos desde los archivos Excel (CSV) a la base de datos de producción:

- `importar_actividades.ts`: Script base para importar tareas preventivas del 2025.
- `importar_actividades2026.ts`: Script para importar tareas preventivas del 2026.
- `importar_correctivos.ts`: Script para cargar el historial de mantenimientos correctivos.
- `importar_real.ts`: Script principal depurado con las métricas definitivas.

Para ejecutar cualquiera de estos scripts, usa `bun`:

```bash
bun src/test/importar_real.ts
```
