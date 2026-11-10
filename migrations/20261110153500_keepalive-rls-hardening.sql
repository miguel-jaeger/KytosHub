-- Endurece el acceso a la tabla/vista del keepalive.
-- InsForge aplica grants por defecto a anon/authenticated en public; la tabla
-- queda protegida por RLS, pero una vista normal se ejecuta con los permisos
-- del owner y puede filtrar filas. Por eso:
--   1. La vista pasa a security_invoker.
--   2. Se revocan todos los privilegios de anon/authenticated.
--   3. Solo project_admin (API key de admin) puede leer/escribir.

CREATE OR REPLACE VIEW public.keepalive_status
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (source)
  source,
  executed_at AS last_run_at,
  status AS last_status,
  http_status AS last_http_status,
  duration_ms AS last_duration_ms,
  client_ip AS last_client_ip,
  user_agent AS last_user_agent,
  details AS last_details,
  now() - executed_at AS time_since_last_run,
  (now() - executed_at) > interval '36 hours' AS is_stale
FROM public.keepalive_runs
ORDER BY source, executed_at DESC;

REVOKE ALL ON public.keepalive_runs FROM anon, authenticated;
REVOKE ALL ON public.keepalive_status FROM anon, authenticated;

GRANT ALL ON public.keepalive_runs TO project_admin;
GRANT SELECT ON public.keepalive_status TO project_admin;
