-- Registro de ejecuciones del keepalive (GitHub Actions y cron externo).
-- La tabla vive en public y solo la usa la edge function `keepalive` con la
-- API key de admin. RLS queda activo y sin políticas para anon/authenticated.

CREATE TABLE IF NOT EXISTS public.keepalive_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'external'
    CHECK (source IN ('github', 'external', 'manual', 'unknown')),
  status text NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failure')),
  http_status integer NOT NULL DEFAULT 200,
  executed_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer,
  client_ip text,
  user_agent text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS keepalive_runs_executed_at_idx
  ON public.keepalive_runs (executed_at DESC);

CREATE INDEX IF NOT EXISTS keepalive_runs_source_executed_at_idx
  ON public.keepalive_runs (source, executed_at DESC);

ALTER TABLE public.keepalive_runs ENABLE ROW LEVEL SECURITY;

-- Estado actual por origen: última ejecución y si está vencida.
-- Para un cron diario, más de 36 h sin ejecución se considera vencido.
CREATE OR REPLACE VIEW public.keepalive_status AS
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

COMMENT ON TABLE public.keepalive_runs IS
  'Historial de pings del keepalive de InsForge (GitHub Actions y cron externo).';
COMMENT ON VIEW public.keepalive_status IS
  'Última ejecución del keepalive por origen y estado de vencimiento.';
