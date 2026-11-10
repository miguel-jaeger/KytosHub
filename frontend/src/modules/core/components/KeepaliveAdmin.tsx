import { useKeepaliveStatus } from '../hooks/useKeepaliveStatus';
import type { KeepaliveRun, KeepaliveStatusRow } from '../hooks/useKeepaliveStatus';

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub Actions',
  external: 'Cron externo',
  manual: 'Manual',
  unknown: 'Desconocido'
};

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function timeAgo(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return 'hace menos de 1 min';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return `hace ${days} d ${hours % 24} h`;
}

function StatusBadge({ status, stale }: { status: string; stale?: boolean }) {
  if (stale) return <span className="status-badge status-warn">Sin ejecución reciente</span>;
  if (status === 'success') return <span className="status-badge status-occupied">OK</span>;
  return <span className="status-badge status-late">Fallo</span>;
}

function detailLabel(details: Record<string, unknown> | null): string {
  if (!details) return '—';
  const method = typeof details.method === 'string' ? details.method : '';
  const path = typeof details.path === 'string' ? details.path : '';
  return [method, path].filter(Boolean).join(' ') || '—';
}

function StatusCard({ row }: { row: KeepaliveStatusRow }) {
  return (
    <div className="module-card">
      <div className="module-card-head">
        <div>
          <h4>{sourceLabel(row.source)}</h4>
          <p>Última ejecución: {formatDateTime(row.last_run_at)}</p>
        </div>
        <StatusBadge status={row.last_status} stale={row.is_stale} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', marginTop: '0.75rem' }}>
        <div>
          <small className="text-muted">HTTP</small>
          <div>{row.last_http_status ?? '—'}</div>
        </div>
        <div>
          <small className="text-muted">Duración</small>
          <div>{row.last_duration_ms != null ? `${row.last_duration_ms} ms` : '—'}</div>
        </div>
        <div>
          <small className="text-muted">Hace</small>
          <div>{timeAgo(row.last_run_at)}</div>
        </div>
        <div>
          <small className="text-muted">IP</small>
          <div>{row.last_client_ip || '—'}</div>
        </div>
      </div>
    </div>
  );
}

function RunsTable({ runs }: { runs: KeepaliveRun[] }) {
  return (
    <div className="users-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Origen</th>
            <th>Estado</th>
            <th>HTTP</th>
            <th>Ejecutado</th>
            <th>Hace</th>
            <th>Duración</th>
            <th>IP</th>
            <th>User-Agent</th>
            <th>Detalle</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id}>
              <td>{sourceLabel(run.source)}</td>
              <td><StatusBadge status={run.status} /></td>
              <td>{run.http_status}</td>
              <td>{formatDateTime(run.executed_at)}</td>
              <td>{timeAgo(run.executed_at)}</td>
              <td>{run.duration_ms != null ? `${run.duration_ms} ms` : '—'}</td>
              <td>{run.client_ip || '—'}</td>
              <td title={run.user_agent || ''}>{run.user_agent ? `${run.user_agent.slice(0, 60)}${run.user_agent.length > 60 ? '…' : ''}` : '—'}</td>
              <td><code>{detailLabel(run.details)}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeepaliveAdmin() {
  const { status, runs, generatedAt, loading, refreshing, error, refresh } = useKeepaliveStatus();

  return (
    <div className="dashboard">
      <div className="header">
        <div>
          <h2>Estado del Cron</h2>
          <small className="text-muted">Ejecuciones del keepalive de InsForge (GitHub Actions y cron externo).</small>
        </div>
        <button onClick={() => void refresh()} disabled={loading || refreshing}>
          <span className="material-symbols-outlined">refresh</span>
          {refreshing ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {loading ? (
        <div className="loading-message">Cargando estado del cron...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : (
        <>
          {status.length === 0 ? (
            <div className="empty-state"><p>Todavía no hay ejecuciones registradas.</p></div>
          ) : (
            <div className="modules-grid" style={{ marginBottom: '1.25rem' }}>
              {status.map(row => <StatusCard key={row.source} row={row} />)}
            </div>
          )}

          <div className="header" style={{ marginTop: '0.5rem' }}>
            <div>
              <h3>Últimas ejecuciones</h3>
              <small className="text-muted">
                {generatedAt ? `Actualizado: ${formatDateTime(generatedAt)}` : 'Sin datos de actualización'}
              </small>
            </div>
          </div>

          {runs.length === 0 ? (
            <div className="empty-state"><p>No hay ejecuciones para mostrar.</p></div>
          ) : (
            <RunsTable runs={runs} />
          )}
        </>
      )}
    </div>
  );
}
