import { useEffect, useMemo, useState } from 'react';
import { useKeepaliveStatus } from '../hooks/useKeepaliveStatus';
import type { KeepaliveRun } from '../hooks/useKeepaliveStatus';
import { PaginationBar, paginate } from '../../../components/Pagination';

const SOURCE_LABELS: Record<string, string> = {
  github: 'GitHub Actions',
  external: 'Cron externo',
  manual: 'Manual',
  unknown: 'Desconocido'
};

const SOURCE_ORDER = ['github', 'external', 'manual', 'unknown'];

type StatusFilter = 'all' | 'success' | 'failure';
type SourceFilter = 'all' | string;

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] || source;
}

function sourceRank(source: string): number {
  const index = SOURCE_ORDER.indexOf(source);
  return index === -1 ? SOURCE_ORDER.length : index;
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

function StatusBadge({ status }: { status: string }) {
  if (status === 'success') return <span className="status-badge status-occupied">Correcta</span>;
  return <span className="status-badge status-late">Con error</span>;
}

function SummaryCard({ icon, label, value, hint }: { icon: string; label: string; value: string; hint?: string }) {
  return (
    <div className="module-card">
      <div className="module-card-head">
        <div>
          <h4>{label}</h4>
          <p>{hint || '\u00A0'}</p>
        </div>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '1.35rem', fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
    </div>
  );
}

function RunsTable({ runs }: { runs: KeepaliveRun[] }) {
  return (
    <div className="users-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Origen</th>
            <th>Estado</th>
            <th>Detalle</th>
            <th>Duración</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(run => (
            <tr key={run.id}>
              <td>{formatDateTime(run.executed_at)}</td>
              <td>{sourceLabel(run.source)}</td>
              <td><StatusBadge status={run.status} /></td>
              <td><code>HTTP {run.http_status}</code></td>
              <td>{run.duration_ms != null ? `${run.duration_ms} ms` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeepaliveAdmin() {
  const { status, runs, generatedAt, loading, refreshing, error, refresh } = useKeepaliveStatus();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  const sources = useMemo(() => {
    const all = new Set<string>();
    status.forEach(row => all.add(row.source));
    runs.forEach(run => all.add(run.source));
    return Array.from(all).sort((a, b) => sourceRank(a) - sourceRank(b) || a.localeCompare(b));
  }, [status, runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter(run => {
      if (statusFilter !== 'all' && run.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && run.source !== sourceFilter) return false;
      return true;
    });
  }, [runs, statusFilter, sourceFilter]);

  const lastRun = filteredRuns[0] || null;
  const total = filteredRuns.length;
  const successCount = filteredRuns.filter(run => run.status === 'success').length;
  const errorCount = total - successCount;

  useEffect(() => { setPage(1); }, [statusFilter, sourceFilter, perPage]);

  const pageSize = perPage === 'all' ? Math.max(1, total) : perPage;
  const { slice: pagedRuns } = paginate(filteredRuns, page, pageSize);

  const resetFilters = () => {
    setStatusFilter('all');
    setSourceFilter('all');
  };

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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end', marginBottom: '1rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <small className="text-muted">Estado</small>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
                <option value="all">Todos</option>
                <option value="success">Correctas</option>
                <option value="failure">Con error</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
              <small className="text-muted">Origen</small>
              <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                <option value="all">Todos</option>
                {sources.map(source => (
                  <option key={source} value={source}>{sourceLabel(source)}</option>
                ))}
              </select>
            </label>

            <button type="button" onClick={resetFilters} disabled={statusFilter === 'all' && sourceFilter === 'all'}>
              Limpiar filtros
            </button>
          </div>

          <div className="modules-grid" style={{ marginBottom: '1.25rem' }}>
            <SummaryCard
              icon="schedule"
              label="Última ejecución"
              value={lastRun ? formatDateTime(lastRun.executed_at) : '—'}
              hint={lastRun ? timeAgo(lastRun.executed_at) : 'Sin ejecuciones para los filtros'}
            />
            <SummaryCard icon="list_alt" label="Ejecuciones" value={String(total)} hint="Según los filtros" />
            <SummaryCard icon="check_circle" label="Correctas" value={String(successCount)} />
            <SummaryCard icon="error" label="Con error" value={String(errorCount)} />
          </div>

          <div className="header" style={{ marginTop: '0.5rem' }}>
            <div>
              <h3>Detalle de ejecuciones</h3>
              <small className="text-muted">
                {generatedAt ? `Actualizado: ${formatDateTime(generatedAt)}` : 'Sin datos de actualización'}
              </small>
            </div>
          </div>

          {total === 0 ? (
            <div className="empty-state"><p>No hay ejecuciones que coincidan con los filtros.</p></div>
          ) : (
            <>
              <RunsTable runs={pagedRuns} />
              <PaginationBar
                total={total}
                page={page}
                perPage={perPage}
                onPageChange={setPage}
                onPerPageChange={setPerPage}
                itemLabel="ejecución"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
