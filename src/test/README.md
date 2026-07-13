# Scripts manuales

Esta carpeta queda solo para scripts manuales seguros.

## Ingesta maquinaria ERP

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
