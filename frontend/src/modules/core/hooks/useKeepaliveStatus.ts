import { useCallback, useEffect, useState } from 'react';
import { invokeFunction } from '../../../lib/insforge';

export interface KeepaliveStatusRow {
  source: string;
  last_run_at: string | null;
  last_status: string;
  last_http_status: number | null;
  last_duration_ms: number | null;
  last_client_ip: string | null;
  last_user_agent: string | null;
  last_details: Record<string, unknown> | null;
  time_since_last_run: string | null;
  is_stale: boolean;
}

export interface KeepaliveRun {
  id: string;
  source: string;
  status: string;
  http_status: number;
  executed_at: string;
  duration_ms: number | null;
  client_ip: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
}

interface KeepaliveResponse {
  success: boolean;
  data: {
    status: KeepaliveStatusRow[];
    runs: KeepaliveRun[];
    generated_at: string;
  } | null;
  error: { message?: string } | null;
}

export function useKeepaliveStatus() {
  const [status, setStatus] = useState<KeepaliveStatusRow[]>([]);
  const [runs, setRuns] = useState<KeepaliveRun[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const { data, error: fnError } = await invokeFunction<KeepaliveResponse>('keepalive-admin', {
        method: 'POST',
        body: { action: 'get', limit: 50 }
      });
      if (fnError) throw fnError;
      if (!data?.success || !data.data) {
        throw new Error(data?.error?.message || 'No se pudo cargar el estado del cron');
      }
      setStatus(data.data.status || []);
      setRuns(data.data.runs || []);
      setGeneratedAt(data.data.generated_at);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresco automático cada minuto; el usuario también puede refrescar a mano.
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { status, runs, generatedAt, loading, refreshing, error, refresh };
}
