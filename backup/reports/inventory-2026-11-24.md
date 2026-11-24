# Inventario de la salva — KytosHub (2026-11-24)

## Proyecto InsForge

| Dato | Valor |
|---|---|
| Nombre | KytosHub |
| Project ID | `f7949f63-4031-43fb-8220-8840c08b0522` |
| Organización | `b0522689-b96d-4e7b-b20f-ddaf3ebc1681` |
| App key / región | `5vvsyy6z` / `us-east` |
| API base | `https://5vvsyy6z.us-east.insforge.app` |
| Edge functions | `https://5vvsyy6z.function2.insforge.app` |
| Frontend | `https://kytos-hub.vercel.app` (Vercel) |
| Plan / instancia | Free / nano, versión de servicio 2.3.5 |
| Estado | activo (pausado por inactividad el 2026-11-10, reactivado) |
| Corte de la salva (T0) | 2026-11-24 10:50 (America/Lima) |

## Base de datos — 14 esquemas, 141 tablas, 5.080 filas

| Esquema | Tablas | Filas |
|---|---:|---:|
| `public` | 8 | 1.293 |
| `auth` | 6 | 458 |
| `condo_condominio_molles` | 25 | 2.030 |
| `condo_aa` | 13 | 256 |
| `condo_nuevo` | 13 | 206 |
| `condo_mi_casa_bonita` | 13 | 135 |
| `condo_test` | 13 | 132 |
| `condo_zzzz` | 13 | 111 |
| `condo_aaaa_aaaaa` | 13 | 46 |
| `condo_tete` | 4 | 188 |
| `condo_villa-los-molles` | 5 | 166 |
| `condo_nuevo_condominio` | 5 | 31 |
| `condo_aaa` | 5 | 21 |
| `condo_condominio-las-gardenias` | 5 | 7 |
| **Total** | **141** | **5.080** |

### Tablas de `public`

| Tabla | Filas |
|---|---:|
| `departments` | 350 |
| `users_global` | 444 |
| `tenant_users` | 421 |
| `keepalive_runs` | 39 |
| `floors` | 35 |
| `towers` | 3 |
| `tenants` | 1 |
| `residents` | 0 |

### Estructura (todos los esquemas)

| Objeto | Cantidad |
|---|---:|
| Esquemas | 14 |
| Tablas | 141 |
| Columnas | 1.181 |
| Índices | 399 |
| Constraints | 531 |
| Políticas RLS | 267 |
| Funciones PL/pgSQL | 205 |
| Triggers | 19 |
| Vistas | 1 (`public.keepalive_status`) |

## Auth

| Dato | Valor |
|---|---:|
| `auth.users` | 453 |
| Correos verificados | 450 |
| Sin verificar | 3 |
| Hashes `$2b$` | 450 |
| Hashes `$2a$` | 3 |
| Usuarios solo OAuth | 0 |
| `auth.user_providers` | 1 (Google) |
| `auth.oauth_configs` | Google y GitHub, ambos con `use_shared_key = true` |

> Las claves compartidas de OAuth no son migrables: en un destino nuevo hay que crear apps
> propias de Google/GitHub y configurar los callbacks.

## Edge functions — 26 desplegadas, todas idénticas al repo

`add-resident`, `billing-maintenance`, `bootstrap-superadmin`, `cart-lending`,
`condo-gates`, `condo-modules`, `condo-stats`, `departments`, `floors`, `general-boards`,
`guard-gate`, `keepalive`, `keepalive-admin`, `list-condominium-users`,
`list-condominiums`, `parking-control`, `plate-ocr`, `provision-tower`,
`register-condominium`, `resident-account`, `residents`, `tower-boards`,
`tower-structure`, `towers`, `verify-turnstile`, `visitor-access`.

- `deploymentUrl`: `https://5vvsyy6z.function2.insforge.app`
- Runtime: `running`
- Snapshot en `backup/functions/` con `manifest.json` (bytes, sha256, `matchesRepo: true`).

## Migraciones

42 archivos en `migrations/` y 42 migraciones aplicadas en InsForge (última:
`20261110153500_keepalive-rls-hardening`). La historia está completa y coincide con el repo.

## Storage, schedules y realtime

| Recurso | Estado al corte |
|---|---|
| Storage | 0 buckets |
| Schedules (cron) | `[]` (sin jobs) |
| Realtime | 0 canales, sin políticas |
| Payments / AI / memory | Sin uso registrado en la app |

## Secretos (solo nombres, nunca valores)

Ver `backup/reports/secrets-2026-11-24.json`. Clasificación:

- **Reservados de plataforma** (el destino genera los suyos): `API_KEY`, `ANON_KEY`,
  `JWT_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`, `INSFORGE_BASE_URL`,
  `VERCEL_WEBHOOK_SECRET`.
- **De la aplicación** (copiar al gestor de secretos y recrear): `SMTP_PASSWORD`,
  `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES`, `INSFORGE_API_KEY`.
- **Expirado**: `API_KEY_OLD_1794236123067`.

## Configuración de auth

- Verificación de correo: **activada**, por código.
- Reset de contraseña: por código.
- Contraseña: mínimo 6, sin requisitos extra.
- Registro abierto (`disable_signup = false`).
- Redirects permitidos: `http://localhost:3000`, `http://localhost:5173`,
  `https://kytos-hub.vercel.app`.
- SMTP: Gmail (`smtp.gmail.com:465`), remitente `miguel.jaeger@gmail.com`, contraseña en
  el vault (`SMTP_PASSWORD`).

## Frontend

Variables (en `frontend/.env`, ignorado por git):

```env
VITE_INSFORGE_URL=https://5vvsyy6z.us-east.insforge.app
VITE_INSFORGE_ANON_KEY=anon_...   # valor en el gestor de secretos
VITE_CLOUDINARY_CLOUD_NAME=dhecags26
VITE_CLOUDINARY_UPLOAD_PRESET=condominios
VITE_TURNSTILE_SITE_KEY=<sitekey>
```

`vercel.json` no tiene URLs de InsForge hardcodeadas (build desde `frontend/`, rewrites SPA).
Las imágenes se alojan en Cloudinary, no en el storage de InsForge.

## Artefactos de la salva

| Archivo | Tamaño | SHA256 (inicio) |
|---|---:|---|
| `backup/cloud/20261110_023601.sql.gz` (snapshot previo) | 2.001.977 B | `76bb083e5adb2d19…` |
| `backup/cloud/20261124_154922.sql.gz` (snapshot nuevo) | 2.033.256 B | `f5931a9535250c…` |
| `backup/dumps/full-system-2026-11-24_1050.sql` | 11.477.504 B | `6eca12c27829f2bd…` |
| `backup/dumps/all-schemas-2026-11-24_1051.sql` | 1.012.160 B | `162bd3b1e7624a4a…` |
| `backup/dumps/db-2026-11-24_1050.sql` | 432.598 B | `9b8141a95929b9a4…` |
| `backup/schema/schema-latest.sql` | 75.965 B | `a988246b93f8895d…` |

Verificación: todos los `sha256` coinciden con sus sidecars; los conteos por esquema de la
salva portable coinciden exactamente con la base viva (tolerancia 0); el `pg_dump` contiene
187 bloques `COPY`, 127 de esquemas `condo_*` y `auth.users`.

## Notas y decisiones

- El backup cloud anterior `checkpoint-2026-09-24` se eliminó para liberar la cuota Free
  (1 backup manual). Su contenido era anterior al snapshot `2026-11-10`, que sí quedó
  descargado y validado antes de la rotación.
- `insforge db export` solo cubre `public`; por eso la salva incluye un exportador propio
  multi-esquema (`backup/scripts/dump-schemas.mjs`) y el `pg_dump` completo.
- Los datos personales (`auth.users`, residentes, vehículos) están **solo** en
  `backup/dumps/` y `backup/cloud/`, ignorados por git.
