import { useState, useEffect } from 'react';
import { useBillingMaintenance } from '../hooks/useBillingMaintenance';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { MorososReport } from '../types';

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

export function MorososView({ schemaName, enabled, towerOnly }: { schemaName?: string; enabled?: boolean; towerOnly?: boolean }) {
  const billing = useBillingMaintenance(schemaName, enabled);
  const [report, setReport] = useState<MorososReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  useEffect(() => {
    if (!schemaName || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    billing.fetchMorosos().then(r => {
      if (!cancelled) setReport(r || null);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : 'Error al cargar morosos');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schemaName, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;
  if (loading) return <div className="loading-message">Consultando morosos...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!report) return <div className="empty-state"><p>No hay datos de morosidad.</p></div>;

  const { slice } = paginate(report.departments, page, perPage === 'all' ? report.departments.length : perPage);

  return (
    <div>
      <div className="header">
        <h3>Departamentos morosos</h3>
        <div className="import-result-summary" style={{ justifyContent: 'flex-start' }}>
          <div className="import-result-count"><span className="material-symbols-outlined">warning</span><span><strong>{report.total_departments_morosos}</strong> departamento(s) moroso(s)</span></div>
          <div className="import-result-count"><span className="material-symbols-outlined">account_balance_wallet</span><span><strong>{fmtMoney(report.total_pending)}</strong> pendiente de cobro</span></div>
        </div>
      </div>

      {towerOnly ? (
        <div className="empty-state"><p>La Junta Directiva de tu torre puede consultar aquí a los departamentos con cuotas pendientes.</p></div>
      ) : (
        report.towers.length > 0 && (
          <div className="modules-grid" style={{ marginBottom: '1rem' }}>
            {report.towers.map(t => (
              <div key={t.tower_id} className="module-card">
                <div className="module-card-head">
                  <div><h4>Torre {t.name} ({t.code})</h4><p>{t.departments_morosos} departamento(s) moroso(s)</p></div>
                </div>
                <div className="board-notes text-muted" style={{ marginTop: '0.3rem' }}>
                  Pendiente: <strong>{fmtMoney(t.pending_amount)}</strong>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {report.departments.length === 0 ? (
        <div className="empty-state"><p>No hay departamentos con cuotas pendientes. ¡Todos están al día!</p></div>
      ) : (
        <div className="users-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Departamento</th>
                <th>Torre</th>
                <th>Cuotas pendientes</th>
                <th>Monto pendiente</th>
                <th>Vencido</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {slice.map(d => (
                <tr key={d.department_id}>
                  <td>{d.department_number}</td>
                  <td>{d.tower?.code || '-'}</td>
                  <td>{d.pending_count}</td>
                  <td><strong>{fmtMoney(d.pending_amount)}</strong></td>
                  <td>
                    {d.overdue
                      ? <span className="status-badge status-late">Vencido ({fmtMoney(d.overdue_amount)})</span>
                      : <span className="status-badge status-warn">En plazo</span>}
                  </td>
                  <td>
                    {d.invoices.map(i => (
                      <div key={i.id}>
                        <small>
                          {i.cycles?.label || '—'} · {fmtMoney(i.remaining)} {i.cycles && new Date(i.cycles.end_date) < new Date() ? '(vencido)' : ''}
                        </small>
                      </div>
                    ))}
                    {d.fines.map(f => (
                      <div key={f.id}><small>Multa: {f.concept} · {fmtMoney(f.amount)}</small></div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar
            total={report.departments.length}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={n => setPerPage(n)}
            itemLabel="departamento"
          />
        </div>
      )}
    </div>
  );
}