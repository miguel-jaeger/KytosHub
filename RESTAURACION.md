# Restauración del proyecto KytosHub (InsForge)

Guía ejecutable para que un agente de IA pueda recuperar y volver a desplegar el proyecto **KytosHub** si el backend de InsForge se pausa o es necesario recrearlo desde cero.

> **Proyecto InsForge:** `KytosHub`
> **Org:** `b0522689-b96d-4e7b-b20f-ddaf3ebc1681`
> **Project ID:** `f7949f63-4031-43fb-8220-8840c08b0522`
> **API base:** `https://5vvsyy6z.us-east.insforge.app`
> **Backup de datos:** `331c41ac-1d79-405f-9d25-b6cf4efb2e77` (nombre: `checkpoint-2026-09-24`)
> **Frontend en producción:** `https://kytos-hub.vercel.app`

---

## Qué hay guardado y dónde

| Recurso | Ubicación |
|---------|-----------|
| Código frontend (React + Vite + TS) | `frontend/src/` en este repo |
| Migraciones SQL (28, todo el esquema/RLS/triggers) | `migrations/*.sql` en este repo |
| Edge functions (23) | `functions/*.ts` en este repo |
| Configuración backend (auth, SMTP, storage, realtime) | `insforge.toml` en este repo |
| Variables de entorno del frontend | `frontend/.env` (NO subir a git) |
| Configuración de deploy de Vercel | `vercel.json` en este repo |
| Datos de la base de datos + storage (snapshot) | Backup `checkpoint-2026-09-24` en InsForge |

**Secretos que NO están en el repo** (viven en el proyecto InsForge, se regeneran al crear proyecto nuevo):
`SMTP_PASSWORD`, `INSFORGE_API_KEY`, `JWT_SECRET`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_KEY_ID`, `API_KEY`, `ANON_KEY`, `INSFORGE_BASE_URL`, `VERCEL_WEBHOOK_SECRET`.

> ⚠️ `.insforge/project.json` contiene la API key — debe estar en `.gitignore` y **no** debe subirse ni compartirse.

> ⚠️ `frontend/.env` contiene la anon key + URL del backend — no debe subirse a git. En Vercel se configuran las variables de entorno en el dashboard (o se inyectan en el build).

---

## Escenario A: El proyecto InsForge se pausó (pero existe todavía)

Se "restaura" (reactiva) sin perder datos. No se recrea nada.

```bash
npx -y @insforge/cli login
npx -y @insforge/cli link --project-id f7949f63-4031-43fb-8220-8840c08b0522 -y
npx -y @insforge/cli projects restore
```

Comprobar estado con:

```bash
npx -y @insforge/cli projects get --json
npx -y @insforge/cli diagnose
```

El frontend no necesita cambios: sigue apuntando a la misma URL.

---

## Escenario B: Hay que recrear el proyecto desde cero

### Paso 1 — Crear y vincular un proyecto nuevo

```bash
npx -y @insforge/cli login
npx -y @insforge/cli create --json   # guarda el nuevo project_id y appkey de la salida
npx -y @insforge/cli link --project-id <NUEVO_PROJECT_ID> --org-id b0522689-b96d-4e7b-b20f-ddaf3ebc1681 -y
```

Tomar nota del **nuevo** `appkey`, `region` y API base (ej. `https://XXXX.us-east.insforge.app`). Todo lo siguiente usa el proyecto recién creado.

### Paso 2 — Aplicar migraciones (esquema, RLS, triggers)

Las migraciones están ordenadas por nombre de archivo (timestamp creciente). Aplícalas en orden:

```bash
# Ver migraciones pendientes
npx -y @insforge/cli db migrations list --json

# Aplicar todas en orden
npx -y @insforge/cli db migrations up --all
```

El CLI recorre `migrations/` y aplica los archivos siguiendo el orden del timestamp. Hay 28 migraciones; al terminar, `db migrations list` debe reportarlas todas aplicadas.

### Paso 3 — Desplegar las edge functions

Cada archivo `functions/<slug>.ts` corresponde a una función con el mismo nombre (slug).

```bash
npx -y @insforge/cli functions deploy add-resident --file functions/add-resident.ts
npx -y @insforge/cli functions deploy billing-maintenance --file functions/billing-maintenance.ts
npx -y @insforge/cli functions deploy bootstrap-superadmin --file functions/bootstrap-superadmin.ts
npx -y @insforge/cli functions deploy cart-lending --file functions/cart-lending.ts
npx -y @insforge/cli functions deploy condo-gates --file functions/condo-gates.ts
npx -y @insforge/cli functions deploy condo-modules --file functions/condo-modules.ts
npx -y @insforge/cli functions deploy condo-stats --file functions/condo-stats.ts
npx -y @insforge/cli functions deploy departments --file functions/departments.ts
npx -y @insforge/cli functions deploy floors --file functions/floors.ts
npx -y @insforge/cli functions deploy general-boards --file functions/general-boards.ts
npx -y @insforge/cli functions deploy guard-gate --file functions/guard-gate.ts
npx -y @insforge/cli functions deploy list-condominium-users --file functions/list-condominium-users.ts
npx -y @insforge/cli functions deploy list-condominiums --file functions/list-condominiums.ts
npx -y @insforge/cli functions deploy parking-control --file functions/parking-control.ts
npx -y @insforge/cli functions deploy plate-ocr --file functions/plate-ocr.ts
npx -y @insforge/cli functions deploy provision-tower --file functions/provision-tower.ts
npx -y @insforge/cli functions deploy register-condominium --file functions/register-condominium.ts
npx -y @insforge/cli functions deploy resident-account --file functions/resident-account.ts
npx -y @insforge/cli functions deploy residents --file functions/residents.ts
npx -y @insforge/cli functions deploy tower-boards --file functions/tower-boards.ts
npx -y @insforge/cli functions deploy tower-structure --file functions/tower-structure.ts
npx -y @insforge/cli functions deploy towers --file functions/towers.ts
npx -y @insforge/cli functions deploy visitor-access --file functions/visitor-access.ts
```

Verificar:

```bash
npx -y @insforge/cli functions list --json   # deben estar las 23 activas
```

### Paso 4 — Aplicar la configuración del backend (`insforge.toml`)

```bash
npx -y @insforge/cli config plan
npx -y @insforge/cli config apply
```

> `insforge.toml` referencia `env(SMTP_PASSWORD)` para el SMTP. Define ese secreto:
> ```bash
> npx -y @insforge/cli secrets add SMTP_PASSWORD <valor-de-cuenta-gmail>
> ```
> (La cuenta SMTP usada es `miguel.jaeger@gmail.com`, host `smtp.gmail.com`, puerto 465.)

Esto configura: redirects de auth (Vercel + localhost), verificación de email por código, política de contraseñas, límite de 50 MB en storage y retenciones de realtime/schedules.

### Paso 5 — Restaurar los datos (base + storage)

Restaurar el backup creado en el proyecto nuevo. **OJO:** este comando sobrescribe la base y el storage actuales del proyecto con el snapshot.

```bash
npx -y @insforge/cli backups list --json                                   # confirmar el backup_id
npx -y @insforge/cli backups restore 331c41ac-1d79-405f-9d25-b6cf4efb2e77 --project <NUEVO_PROJECT_ID>
```

> Al restaurar en un proyecto **nuevo**, hazlo después de aplicar migraciones (Paso 2)
> para que el esquema exista. El restore repliega los datos encima del esquema restaurado.
>
> Si ocurren conflictos por identidades/sesiones ya insertadas tras aplicar migraciones,
> es preferible restaurar antes de desplegar funciones o usar `--wait` y verificar
> con `npx -y @insforge/cli db query "select count(*) from tenants" --json`.

### Paso 6 — Regenerar credenciales / secretos reservados

Al crear un proyecto nuevo, InsForge regenera automáticamente `API_KEY`, `ANON_KEY`,
`JWT_*` e `INSFORGE_BASE_URL`. Verificar:

```bash
npx -y @insforge/cli secrets list --all
```

### Paso 7 — Actualizar el frontend a la nueva URL/anon-key

Editar `frontend/.env` con los valores del **nuevo** proyecto:

```env
VITE_INSFORGE_URL=https://<NUEVO_APPKEY>.<NUEVA-REGION>.insforge.app
VITE_INSFORGE_ANON_KEY=anon_<nueva-key-anonima>
# Cloudinary no cambia (sigue igual):
VITE_CLOUDINARY_CLOUD_NAME=dhecags26
VITE_CLOUDINARY_UPLOAD_PRESET=condominios
```

Actualizar también las variables de entorno en la configuración del deploy de Vercel
(dashboard de Vercel) y desplegar el frontend, o arrancar en local:

```bash
cd frontend
npm install
npm run dev      # local
npm run build    # build de producción (tsc + vite + copy404)
```

---

## Verificación post-restauración

```bash
npx -y @insforge/cli diagnose                          # salud general
npx -y @insforge/cli db query "select count(*) from tenants" --json
npx -y @insforge/cli db query "select count(*) from tenants where status = 'ACTIVE'" --json
npx -y @insforge/cli functions list --json            # las 23 funciones activas
npx -y @insforge/cli secrets list --all               # secretos presentes
npx -y @insforge/cli config plan                      # config sin cambios pendientes
```

Comprobar en navegador:
- Login/registro funcionan.
- Registro completo de un condominio (wizard) y aprovisionamiento de torres/pisos/departamentos.
- Estadísticas del condominio (`condo-stats`) muestran datos.
- Parking: OCR de placas (`plate-ocr`), sesión de puerta (`guard-gate`), control (`parking-control`).
- Módulos de juntas directivas (torre/general) y visitas.
- Facturación/mantenimiento (`billing-maintenance`) procesa recibos y morosidad.
- Correos de verificación/reset llegan (SMTP).

---

## Resumen rápido (copiar/pegar para un agente)

```bash
# Escenario B: recrear todo
npx -y @insforge/cli login
npx -y @insforge/cli create --json
npx -y @insforge/cli link -y
npx -y @insforge/cli db migrations up --all
npx -y @insforge/cli functions deploy add-resident --file functions/add-resident.ts
npx -y @insforge/cli functions deploy billing-maintenance --file functions/billing-maintenance.ts
npx -y @insforge/cli functions deploy bootstrap-superadmin --file functions/bootstrap-superadmin.ts
npx -y @insforge/cli functions deploy cart-lending --file functions/cart-lending.ts
npx -y @insforge/cli functions deploy condo-gates --file functions/condo-gates.ts
npx -y @insforge/cli functions deploy condo-modules --file functions/condo-modules.ts
npx -y @insforge/cli functions deploy condo-stats --file functions/condo-stats.ts
npx -y @insforge/cli functions deploy departments --file functions/departments.ts
npx -y @insforge/cli functions deploy floors --file functions/floors.ts
npx -y @insforge/cli functions deploy general-boards --file functions/general-boards.ts
npx -y @insforge/cli functions deploy guard-gate --file functions/guard-gate.ts
npx -y @insforge/cli functions deploy list-condominium-users --file functions/list-condominium-users.ts
npx -y @insforge/cli functions deploy list-condominiums --file functions/list-condominiums.ts
npx -y @insforge/cli functions deploy parking-control --file functions/parking-control.ts
npx -y @insforge/cli functions deploy plate-ocr --file functions/plate-ocr.ts
npx -y @insforge/cli functions deploy provision-tower --file functions/provision-tower.ts
npx -y @insforge/cli functions deploy register-condominium --file functions/register-condominium.ts
npx -y @insforge/cli functions deploy resident-account --file functions/resident-account.ts
npx -y @insforge/cli functions deploy residents --file functions/residents.ts
npx -y @insforge/cli functions deploy tower-boards --file functions/tower-boards.ts
npx -y @insforge/cli functions deploy tower-structure --file functions/tower-structure.ts
npx -y @insforge/cli functions deploy towers --file functions/towers.ts
npx -y @insforge/cli functions deploy visitor-access --file functions/visitor-access.ts
npx -y @insforge/cli config apply
npx -y @insforge/cli secrets add SMTP_PASSWORD <valor-gmail>
npx -y @insforge/cli backups restore 331c41ac-1d79-405f-9d25-b6cf4efb2e77 --project <NUEVO_PROJECT_ID>
```

> Actualizar `frontend/.env` con la nueva URL y anon key del proyecto recreado, y las
> variables de entorno en Vercel, antes de desplegar el frontend.