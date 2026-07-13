# Cierre backend ajustes de preventivos recurrentes

## Resumen

Se implemento Fase 1 backend para ajustes por ocurrencia en preventivos recurrentes.

La regla base no cambia. El ajuste solo afecta una ocurrencia exacta.

## Archivos tocados

```txt
prisma/schema.prisma
prisma/migrations/20260713120000_add_recurrence_adjustments/migration.sql
src/modules/recurrencias/ajustes-helper.ts
src/modules/recurrencias/08_ajustes.ts
src/modules/recurrencias/02_create.ts
src/modules/recurrencias/05_proyecciones.ts
src/modules/recurrencias/06_materialize.ts
src/modules/recurrencias/07_matriz.ts
src/modules/recurrencias/automations.ts
src/modules/recurrencias/types.ts
src/modules/recurrencias/zod/index.ts
src/routes/recurrencias_rutas.ts
src/modules/tickets/helper.ts
src/modules/tickets/types.ts
```

## Modelo agregado

Enum:

```txt
TipoAjusteRecurrencia
- MOVER
- OMITIR
```

Modelo:

```txt
ReglaRecurrenciaAjuste
```

Identidad:

```txt
reglaRecurrenciaId + fechaOriginal
```

Indices:

```txt
unique(reglaRecurrenciaId, fechaOriginal)
index(reglaRecurrenciaId, periodoAnio, periodoMes)
index(tipo, activo)
```

## Campo agregado en Tarea

```txt
fechaProgramadaPreventiva DateTime?
```

Regla:

```txt
fechaCicloLogica = identidad original
fechaProgramadaPreventiva = fecha efectiva si se movio
fechaProgramada = fechaProgramadaPreventiva ?? fechaCicloLogica
fechaVencimiento = fin de mes de fechaCicloLogica
finalizadoAt = cierre real
```

## Endpoints agregados

```txt
GET    /api/recurrencias/:id/ajustes
POST   /api/recurrencias/:id/ocurrencias/mover
POST   /api/recurrencias/:id/ocurrencias/omitir
DELETE /api/recurrencias/:id/ocurrencias/ajuste
```

Permisos:

```txt
SUPER_ADMIN
JEFE_MTTO
COORDINADOR_MTTO
```

## Reglas de mover

Sin tarea real:

- guarda ajuste `MOVER`;
- no cambia regla base.

Con tarea `PENDIENTE` o `ASIGNADA`:

- guarda ajuste `MOVER`;
- actualiza `fechaProgramadaPreventiva`;
- mantiene `fechaCicloLogica`.

Con tarea en curso, pausada, cerrada, resuelta o cancelada:

- bloquea ajuste;
- no modifica historico.

## Reglas de omitir

Sin tarea real:

- guarda ajuste `OMITIR`;
- cron no genera mantenimiento;
- matriz/proyecciones lo reportan como omitido.

Con tarea real:

- bloquea;
- no borra tarea.

## Quitar ajuste

- desactiva ajuste activo;
- si tarea existe y esta `PENDIENTE` o `ASIGNADA`, limpia `fechaProgramadaPreventiva`;
- si tarea esta en curso o cerrada, bloquea.

## Cron

`procesarRecurrenciasProgramadas()` ahora resuelve ajuste antes de crear cada ocurrencia.

- `OMITIR`: no crea mantenimiento.
- `MOVER`: crea con `fechaCicloLogica` original y `fechaProgramadaPreventiva` nueva.
- normal: crea con `fechaProgramadaPreventiva = null`.

## Proyecciones

Las proyecciones agregan campos:

```txt
fechaOriginal
fechaOriginalFormateada
fechaProgramada
fechaProgramadaFormateada
fechaProgramadaPreventiva
fechaProgramadaPreventivaFormateada
ajusteTipo
ajusteMotivo
omitida
movida
movidaDesde
movidaA
```

No se quitan campos previos.

## Matriz

La matriz devuelve:

- `OMITIDO`
- `Movido este mes`
- `Omitido este mes`
- `fechaOriginal`
- `fechaProgramada`
- `fechaProgramadaPreventiva`
- flags `omitida` y `movida`

Si una ocurrencia esta omitida, no se marca como falta de mantenimiento.

## HOY

HOY sigue con tareas reales.

No se agregan programaciones virtuales.
Ocurrencias omitidas no aparecen porque no generan tarea.
Ocurrencias movidas aparecen si ya tienen tarea real del mes.

Se agrego `fechaProgramada` calculada en DTO de tickets:

```txt
fechaProgramadaPreventiva ?? fechaCicloLogica
```

## Validaciones realizadas

```bash
npm run typecheck
npx prisma validate
git grep -n "tipo.*PREVENTIVO\\|PREVENTIVO.*tipo" src/modules
git grep -n "incumplido\\|penaliz\\|KPI\\|falló técnico\\|fallo técnico" src/modules
```

Resultados:

- Typecheck OK.
- Prisma validate OK.
- `PREVENTIVO` como tipo: sin hits.
- Lenguaje de castigo: solo hits existentes en dashboard/KPI, no relacionados con recurrencias.

## Riesgos pendientes para frontend

- Mostrar `Movido este mes` y `Omitido este mes` en matriz.
- Calendario debe usar `fechaProgramadaPreventiva ?? fechaCicloLogica`.
- Calendario debe ocultar omitidos por default.
- Modales de mover/omitir/quitar ajuste pendientes.
- Acciones deben respetar roles en UI.
