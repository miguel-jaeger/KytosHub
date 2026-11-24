# Restauración y redespliegue — KytosHub

Tres caminos, de menor a mayor esfuerzo. El objetivo es poder levantar el sistema completo
(esquema + datos + auth) en InsForge o en Postgres propio.

## Opción A — Restaurar el mismo proyecto InsForge (rápido)

```bash
npx -y @insforge/cli backups list --json
npx -y @insforge/cli backups restore <id> -y
```

El snapshot cloud (`backup/cloud/*.sql.gz`) también se puede restaurar desde el dashboard.
Incluye `auth.users` (hashes bcrypt), los 12 esquemas `condo_*` y los metadatos internos.

## Opción B — Otro InsForge / Postgres 15+ (dump completo)

Usa `backup/dumps/full-system-<fecha>.sql` (11 MB, `pg_dump` con DDL + datos).

```bash
createdb kytoshub_restore
psql "postgresql://usuario:clave@host:5432/kytoshub_restore" -v ON_ERROR_STOP=1 \
  -f backup/dumps/full-system-2026-11-24_1050.sql
```

Notas:

- Usa `psql` 16.15 o superior: el dump trae el meta-comando `\restrict` de las versiones
  parcheadas de `pg_dump`.
- El dump incluye un preludio de roles (`project_admin`, etc.). Si no puedes crearlos,
  restaura con `--no-owner --no-privileges` (requiere el binario `pg_dump`/`psql`).
- Después de restaurar, cambia las URLs y claves del frontend (Opción C, paso 4).

## Opción C — Reconstruir desde migraciones + datos portables

### 1. Crear el proyecto y aplicar el esquema

```bash
npx -y @insforge/cli link --project-id <nuevo-project-id> -y
npx -y @insforge/cli db migrations up --all
```

Si faltan migraciones en la historia, aplica `backup/schema/schema-latest.sql` para el
`public` y luego las migraciones `condo_*`. El esquema de cada condominio se crea con
`provision_tenant_schema(nombre, slug, ...)`.

### 2. Importar los datos de todos los esquemas

```bash
# Requiere que existan los 14 esquemas y sus tablas
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backup/dumps/all-schemas-2026-11-24_1051.sql
```

El archivo usa `SET session_replication_role = replica;` para desactivar FKs y triggers
durante la carga. Si el usuario no es superusuario, elimina esa línea y ordena las tablas
según sus dependencias.

Contenido verificado al 2026-11-24: **14 esquemas, 141 tablas, 5.080 filas**, incluidos
`auth.users` (453), `public.users_global` (444), `public.tenant_users` (421) y
`condo_condominio_molles.departments` (900).

### 3. Auth y OAuth

- Los usuarios y hashes vienen en `auth.users` (450 `$2b$`, 3 `$2a$`; 3 sin verificar).
- Google y GitHub usan **claves compartidas de InsForge** (`use_shared_key = true`): en el
  destino hay que crear apps propias y configurar callbacks.
- SMTP: recrear `SMTP_PASSWORD` en el vault del destino (`insforge.toml` ya referencia
  `env(SMTP_PASSWORD)`).

### 4. Frontend

Variables de entorno (hoy en `frontend/.env`, ignorado por git):

```env
VITE_INSFORGE_URL=https://<appkey>.<region>.insforge.app
VITE_INSFORGE_ANON_KEY=<anon_key>
VITE_CLOUDINARY_CLOUD_NAME=dhecags26
VITE_CLOUDINARY_UPLOAD_PRESET=condominios
VITE_TURNSTILE_SITE_KEY=<sitekey>
```

Revisa que no queden URLs de InsForge hardcodeadas:

```bash
grep -rn "insforge" frontend/src frontend/.env.example vercel.json
```

## Verificación post-restauración

```bash
# Conteos por esquema (deben coincidir con el inventario)
npx -y @insforge/cli db query "select schemaname, count(*) as tablas from pg_stat_user_tables group by 1 order by 1" --json

# Login de prueba, dashboard, alta de visita y préstamo de carrito
```

Criterios mínimos:

- [ ] Login email/contraseña con una cuenta existente.
- [ ] Los 12 condominios aparecen con sus torres, departamentos y residentes.
- [ ] RLS: un usuario de un condominio no ve datos de otro.
- [ ] Las 26 edge functions responden (`/keepalive` debe devolver 200).
- [ ] Storage vacío (0 buckets al corte) y sin schedules que recrear.

## Rollback

No se borró nada en InsForge durante la salva (solo se rotó el backup cloud). Para volver
atrás basta con restaurar el snapshot anterior `backup/cloud/20261110_023601.sql.gz` o
mantener el proyecto original intacto y revertir variables del frontend.
