# Cierre backend recurrencias y matriz

## Endpoints agregados

### GET /api/recurrencias

Listado global de reglas recurrentes.

Query soportada:

```txt
activo=true|false
q=
maquinaId=
tecnicoId=
page=
limit=
```

Respuesta:

```json
{
  "success": true,
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

Incluye datos de regla, maquina y tecnico responsable.

### GET /api/recurrencias/matriz?year=2026

Matriz anual calculada en backend.

Reglas:

- usa `year`, no `anio`;
- devuelve una fila por regla recurrente;
- no devuelve una fila por maquina;
- si una maquina tiene varias reglas, salen varias filas;
- mezcla tickets reales y proyecciones;
- tickets reales ganan sobre proyeccion por `reglaRecurrenciaId + fechaCicloLogica`;
- meses usan claves `"1"` a `"12"`;
- cada mes puede contener multiples ciclos.

Respuesta:

```json
{
  "success": true,
  "year": 2026,
  "total": 0,
  "rows": []
}
```

## Orden de rutas

Las rutas especificas quedan antes de la ruta dinamica:

```txt
GET /api/recurrencias
GET /api/recurrencias/matriz
GET /api/recurrencias/proyecciones
GET /api/recurrencias/:id
GET /api/recurrencias/:id/proyeccion
```

Esto evita que `matriz` o `proyecciones` sean interpretados como `:id`.

## Antiduplicados

La matriz usa la misma llave funcional:

```txt
reglaRecurrenciaId + fechaCicloLogica
```

Tickets reales se indexan con esa llave y reemplazan la proyeccion del mismo ciclo.

La base ya conserva constraint unico:

```txt
Tarea(reglaRecurrenciaId, fechaCicloLogica)
```

## Materialize futuro

`POST /api/recurrencias/:id/materialize` conserva contrato existente.

Ajuste agregado:

- ciclo vencido o actual: permitido;
- ciclo futuro sin confirmacion: bloqueado;
- ciclo futuro con `confirmarFuturo=true`: permitido explicitamente.

## Pausar regla

La baja logica sigue usando:

```txt
activo = false
```

No cancela tickets vivos ya creados.

## Invariantes

- No se toco frontend.
- No se toco Prisma schema.
- No se crearon migraciones.
- No se tocaron modulos de tickets ni maquinas.
- `PREVENTIVO` sigue siendo `clasificacion`.
- Tickets generados por recurrencia siguen usando `tipo = PLANEADA`.
- No se creo enum `IMPRESO`.

## Validaciones

```bash
npm run typecheck
```

Resultado: OK.

Scripts no existentes en backend:

```txt
npm run build
npm run lint
npm test
```

## Pruebas manuales

No se ejecutaron requests reales por requerir backend levantado y token de autenticacion.

Rutas compilan y pasan typecheck.

## Riesgos pendientes

- Origen real de `IMPRESO` sigue pendiente.
- Performance de matriz debe validarse con volumen real de reglas semanales.
- QA manual pendiente con auth:
  - `GET /api/recurrencias?limit=10`
  - `GET /api/recurrencias/matriz?year=2026`
  - `GET /api/recurrencias/:id`
  - `POST /api/recurrencias/:id/materialize`
