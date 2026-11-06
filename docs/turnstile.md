# Cloudflare Turnstile en KytosHub

Protección anti-bot para el inicio de sesión y el registro de cuentas.

## Cómo funciona

```
LoginPage (React)
  ├─ TurnstileWidget ──► reto en el navegador ──► token (5 min, un solo uso)
  ├─ invokeFunction('verify-turnstile', { token })
  │     └─ Edge Function valida el token en Cloudflare Siteverify
  │           └─ usa TURNSTILE_SECRET_KEY (secret de InsForge)
  └─ si la validación es correcta → auth.signIn / auth.signUp
```

- **Sitekey**: clave pública, se incrusta en el bundle del frontend.
- **Secret key**: privada, vive únicamente en los secrets de InsForge.
- Si el login falla, el widget se remonta para obtener un token nuevo (los
  tokens son de un solo uso).

## 1. Parámetros en Cloudflare

Dashboard → **Turnstile** → **Add widget**.

| Campo | Valor |
| --- | --- |
| Widget name | `KytosHub Auth` |
| Widget Mode | `Managed` |
| Hostnames | `kytos-hub.vercel.app`<br>`localhost` |
| Pre-clearance | Desactivado |

Notas:

- Solo se autorizan hostnames del **frontend**. El backend de InsForge
  (`5vvsyy6z.us-east.insforge.app`) no necesita estar en la lista: el widget se
  renderiza únicamente en el navegador del usuario.
- Los hostnames **no admiten comodines**. Agregar un hostname autoriza también
  sus subdominios, pero no el dominio padre ni dominios hermanos.
- Si se usa un dominio propio (por ejemplo `app.kytoshub.com`), agregarlo a la
  lista y sumar el dominio de Vercel si se mantiene.
- Las URLs de **Preview** de Vercel son aleatorias (`kytos-hub-xxxx.vercel.app`)
  y no se pueden cubrir con comodín. Para probar auth en un preview hay que
  agregar ese hostname puntual (límite: 10 hostnames en el plan gratuito) o
  usar claves de prueba (ver sección 5).
- Al guardar el widget, copiar:
  - **Site Key** (`0x4AAAAAAA...`) → va a Vercel.
  - **Secret Key** (`0x4AAAAAAA...`) → va a InsForge.

## 2. Parámetros en Vercel

**Project → Settings → Environment Variables**.

| Nombre | Valor | Entornos |
| --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | El **Site Key** de Cloudflare | Production, Preview, Development |

- Es una variable **pública** (queda embebida en el JS del navegador). No pasa
  nada si se ve en el bundle.
- **No** agregar el secret key en Vercel: la validación ocurre del lado del
  backend de InsForge.
- Vite inyecta las variables en tiempo de **build**: después de agregarla hay
  que hacer **Redeploy** para que aparezca en el sitio.
- `5vvsyy6z.insforge.site` es el backend; no requiere esta variable ni un
  hostname en Turnstile. El widget solo se renderiza en el frontend.

`vercel.json` no requiere cambios: no hay CSP propia que bloquee
`https://challenges.cloudflare.com`.

## 3. Parámetros en InsForge

Desde la raíz del repo:

```bash
# Guardar el secret key como secret del backend
npx -y @insforge/cli secrets add TURNSTILE_SECRET_KEY 0x4AAAAAAA_TU_SECRET_KEY

# Desplegar (o actualizar) la función de validación
npx -y @insforge/cli functions deploy verify-turnstile --file functions/verify-turnstile.ts

# Comprobar que quedó activa
npx -y @insforge/cli functions list
```

La función es pública (se invoca antes de tener sesión) y responde:

```json
{ "success": true, "data": { "hostname": "kytos-hub.vercel.app", "challengeTs": "..." }, "error": null }
```

En fallo responde `success: false` con `error.code` (`TURNSTILE_FAILED`,
`TURNSTILE_UNAVAILABLE`, `INVALID_TOKEN`, `CONFIG_ERROR`, ...).

Si se rota el secret en Cloudflare, actualizarlo con:

```bash
npx -y @insforge/cli secrets update TURNSTILE_SECRET_KEY --value 0x4AAAAAAA_NUEVO_SECRET
```

## 4. Desarrollo local

1. Agregar el sitekey real a `frontend/.env` (archivo local, no se commitea):

   ```env
   VITE_TURNSTILE_SITE_KEY=0x4AAAAAAA_TU_SITE_KEY
   ```

2. Tener `localhost` en los hostnames del widget en Cloudflare.
3. `npm run dev`. El widget funciona igual porque la función desplegada usa el
   secret real.

Si no se define `VITE_TURNSTILE_SITE_KEY`, en desarrollo el login continúa sin
captcha y en producción se bloquea con un mensaje de configuración. Esto evita
desplegar el login sin protección por un `.env` incompleto.

## 5. Claves de prueba de Cloudflare (opcional)

| Sitekey | Secret key | Resultado |
| --- | --- | --- |
| `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` | Siempre pasa |
| `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` | Siempre falla |
| `3x00000000000000000000FF` | `1x0000000000000000000000000000000AA` | Reto interactivo |

Las claves de prueba funcionan en cualquier dominio, incluido `localhost`. Para
usarlas hay que cambiar **ambas** (sitekey en el frontend y secret en InsForge)
o desplegar una rama de backend separada.

## 6. Archivos involucrados

| Archivo | Rol |
| --- | --- |
| `frontend/src/lib/turnstile.ts` | Carga el script oficial y expone el sitekey |
| `frontend/src/components/TurnstileWidget.tsx` | Widget con render explícito para SPA |
| `frontend/src/pages/LoginPage.tsx` | Muestra el widget y exige el token |
| `frontend/src/contexts/AuthContext.tsx` | Valida el token antes de `signIn`/`signUp` |
| `functions/verify-turnstile.ts` | Valida contra Siteverify con el secret |
| `frontend/.env.example` | Documenta `VITE_TURNSTILE_SITE_KEY` |

## 7. Solución de problemas

| Síntoma | Causa probable |
| --- | --- |
| El widget no aparece | Falta `VITE_TURNSTILE_SITE_KEY` o no se redeployó Vercel |
| `Error 300030` / hostname no autorizado | El hostname actual no está en Cloudflare |
| `La verificación falló o expiró` | Token vencido (>5 min) o reutilizado; se remonta el widget |
| `La verificación de seguridad no está configurada` | Falta `TURNSTILE_SECRET_KEY` en InsForge |
| Funciona en local pero no en producción | Se agregó la variable en Vercel pero falta el Redeploy |

## 8. Límite de seguridad importante

InsForge Auth no valida Turnstile de forma nativa: la verificación se hace en
`verify-turnstile` antes de llamar al SDK. Esto protege el flujo real de la app
(login y registro desde KytosHub), pero alguien con la anon key pública podría
intentar llamar directamente a los endpoints de auth de InsForge saltándose la
UI.

Si se necesita bloqueo estricto a nivel de plataforma, las opciones son:

1. Colocar InsForge detrás de Cloudflare (proxy/WAF) y aplicar reglas de rate
   limiting sobre `/api/auth/*`.
2. Proxy de autenticación propio: una edge function que valide Turnstile y
   reenvíe el login/registro al backend, manejando las cookies de sesión.
3. Rate limiting adicional en Cloudflare sobre el dominio del frontend.

Para el alcance actual (frenar bots y registros masivos desde la interfaz), la
implementación incluida es la recomendada por Cloudflare.
