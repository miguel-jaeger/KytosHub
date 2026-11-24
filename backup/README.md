# Backup y recuperación — KytosHub

Esta carpeta concentra todo lo necesario para **recuperar el sistema completo** (multi-tenant)
si InsForge se pausa, cambia de condiciones o hay que migrar de plataforma.

| Ruta | Qué guarda | ¿Va a git? |
|------|-----------|-----------|
| `backup/functions/` | Código exacto de las **26 edge functions desplegadas** + `manifest.json` con hashes | Sí |
| `backup/schema/schema-latest.sql` | Esquema del `public` sin datos (tablas, RLS, políticas, funciones, triggers, vistas) | Sí |
| `backup/dumps/all-schemas-*.sql` | **Datos de todo el sistema**: `public`, `auth` y los 12 esquemas `condo_*` (141 tablas) | **No** (datos personales) |
| `backup/dumps/full-system-*.sql` | `pg_dump` completo (DDL + datos + auth + esquemas internos), listo para `psql -f` | **No** |
| `backup/dumps/db-*.sql` | Datos del `public` exportados con `db export` | **No** |
| `backup/cloud/*.sql.gz` | Snapshots cloud de InsForge descargados (incluyen `auth.users`) | **No** |
| `backup/dumps/manifest.json` | Historial de salvas con hashes y verificaciones | **No** |
| `backup/reports/` | Inventario de estructura, auditoría de funciones y configuración exportada | Sí |

> Guía completa de migración (sirve para cualquier proyecto InsForge):
> `.opencode/agents/migracion-insforge.md` en la raíz del proyecto.

## Comandos

```bash
# Salva completa: snapshot cloud + public + todos los esquemas condo_* + esquema + funciones
node backup/scripts/backup.mjs

# Solo datos de todos los esquemas (multi-tenant) + inventario de estructura
node backup/scripts/dump-schemas.mjs

# Copia las funciones desplegadas y las compara con functions/ del repo
node backup/scripts/audit.mjs

# Lista salvas locales, snapshots descargados y backups en InsForge
node backup/scripts/manage.mjs list

# Verifica sha256 + contenido de la última salva
node backup/scripts/manage.mjs verify backup/dumps/db-<fecha>.sql

# Rotación local (conserva 14 por defecto)
node backup/scripts/manage.mjs prune --keep 14
```

## Cómo funciona la salva

`backup.mjs` ejecuta 7 pasos:

1. Descarga el snapshot cloud existente **antes de borrarlo** y valida que sea un `pg_dump`
   con `auth.users` y tablas `condo_*`.
2. Libera el backup cloud (plan Free = 1 manual) y crea uno nuevo del día; lo descarga y lo
   descomprime a `backup/dumps/full-system-<fecha>.sql`.
3. Exporta los datos del `public` con `insforge db export` y verifica conteos.
4. Exporta **todos** los esquemas (`public`, `auth`, `condo_*`) a un SQL portable con
   `INSERT INTO "esquema"."tabla"` y verifica los conteos fila por fila contra la base
   (tolerancia 0). Hoy son 14 esquemas, 141 tablas y 5.080 filas.
5. Regenera `backup/schema/schema-latest.sql` (sin datos, versionado).
6. Copia el código desplegado de cada edge function y falla si difiere del repo.
7. Genera `backup/reports/structure-inventory-<fecha>.json` con columnas, índices,
   constraints, políticas RLS, funciones y triggers de todos los esquemas.

## Multi-tenant

Los datos de cada condominio viven en su propio esquema `condo_<slug>`. `insforge db export`
**solo cubre `public`**, por eso la salva incluye el paso 4 (multi-esquema) y el snapshot
cloud. Al 2026-11-24 hay 12 esquemas de condominio:

`condo_aa`, `condo_aaa`, `condo_aaaa_aaaaa`, `condo_condominio-las-gardenias`,
`condo_condominio_molles`, `condo_mi_casa_bonita`, `condo_nuevo`,
`condo_nuevo_condominio`, `condo_test`, `condo_tete`, `condo_villa-los-molles`, `condo_zzzz`.

El esquema de cada condominio se crea con la función `provision_tenant_schema` de
`migrations/20260902002316_provision-tenant-schema.sql`; para reconstruir desde cero usa
`backup/RESTORE.md`.

## Límites conocidos

- **Plan Free**: 1 backup cloud manual. Se rota: se descarga antes de borrar y se conservan
  14 días en `backup/cloud/` y `backup/dumps/`.
- `db export --row-limit` acepta máximo 10000 filas por tabla. Si una tabla lo supera la
  salva termina con aviso y código 1.
- `storage` no tiene buckets al 2026-11-24 y `schedules` está vacío (`[]`). Si se crean,
  descárgalos aparte con `insforge storage` / `insforge schedules`.
- Los `.env` y `.insforge/project.json` están ignorados por git: las credenciales se
  restauran desde el gestor de secretos, no desde el repo.
