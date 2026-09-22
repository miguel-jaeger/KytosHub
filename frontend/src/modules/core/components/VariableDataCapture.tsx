import { useState, useEffect } from 'react';
import { useBillingMaintenance } from '../hooks/useBillingMaintenance';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { BillingInvoice, BillingVariableData, MaintenanceReceiptItem, Tower } from '../types';

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

function emptyItem(): MaintenanceReceiptItem {
  return { categoria: '', descripcion: '', cantidad: null, monto_total_gasto: null, importe_departamento: 0 };
}

export function VariableDataCapture({ schemaName, enabled }: { schemaName?: string; enabled?: boolean }) {
  const billing = useBillingMaintenance(schemaName, enabled);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [towerId, setTowerId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);

  useEffect(() => {
    if (!schemaName) return;
    let cancelled = false;
    import('../../../lib/insforge').then(({ invokeFunction }) => {
      return invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
    }).then(t => {
      if (!cancelled) {
        const list = (t.data?.data || []).sort((a, b) => a.code.localeCompare(b.code));
        setTowers(list);
        setTowerId(list[0]?.id || '');
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [schemaName]);

  useEffect(() => {
    if (!periodId) setPeriodId(billing.periods[0]?.id || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billing.periods]);

  useEffect(() => {
    if (!schemaName || !periodId || !towerId) { setInvoices([]); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const towerCode = towers.find(t => t.id === towerId)?.code || '';
    billing.fetchInvoices({ period_id: periodId })
      .then(list => {
        if (cancelled) return;
        const filtered = list.filter(i => i.departments?.towers?.code === towerCode);
        setInvoices(filtered);
        setPage(1);
      })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaName, periodId, towerId, towers]);

  const variableOf = (inv: BillingInvoice): BillingVariableData => {
    const base: BillingVariableData = { meters: [], items: [] };
    const v = inv.variable_data;
    if (!v) return base;
    return {
      meters: Array.isArray(v.meters) ? v.meters : [],
      items: Array.isArray(v.items) ? v.items : []
    };
  };

  const patchVariable = (invId: string, patch: (prev: BillingVariableData) => BillingVariableData) => {
    setInvoices(prev => prev.map(inv => {
      if (inv.id !== invId) return inv;
      return { ...inv, variable_data: patch(variableOf(inv)) };
    }));
  };

  const setMeter = (invId: string, idx: number, field: 'label' | 'value', val: string) => {
    patchVariable(invId, prev => {
      const meters = prev.meters.map((m, i) => (i === idx ? { ...m, [field]: val } : m));
      return { ...prev, meters };
    });
  };

  const addMeter = (invId: string) => {
    patchVariable(invId, prev => ({ ...prev, meters: [...prev.meters, { label: '', value: '' }] }));
  };

  const removeMeter = (invId: string, idx: number) => {
    patchVariable(invId, prev => ({ ...prev, meters: prev.meters.filter((_, i) => i !== idx) }));
  };

  const setItem = (invId: string, idx: number, patch: Partial<MaintenanceReceiptItem>) => {
    patchVariable(invId, prev => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it))
    }));
  };

  const addItem = (invId: string) => {
    patchVariable(invId, prev => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };

  const removeItem = (invId: string, idx: number) => {
    patchVariable(invId, prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));
  };

  const itemSubtotal = (inv: BillingInvoice) =>
    variableOf(inv).items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);

  const saveOne = async (inv: BillingInvoice) => {
    setSavingIds(prev => new Set(prev).add(inv.id));
    setError(null);
    try {
      await billing.saveVariableData(inv.id, variableOf(inv));
      setMessage(`Datos guardados para ${inv.departments?.department_number || ''}`);
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSavingIds(prev => {
        const next = new Set(prev);
        next.delete(inv.id);
        return next;
      });
    }
  };

  const saveAll = async () => {
    setError(null);
    let ok = 0;
    for (const inv of invoices) {
      try {
        await billing.saveVariableData(inv.id, variableOf(inv));
        ok++;
      } catch (err) {
        setError(err instanceof Error ? err.message : `Error en ${inv.departments?.department_number || ''}`);
        break;
      }
    }
    setMessage(`Datos guardados en ${ok} departamento(s)`);
    setTimeout(() => setMessage(null), 2500);
  };

  if (!enabled) return null;

  const { slice } = paginate(invoices, page, perPage === 'all' ? invoices.length : perPage);

  return (
    <div>
      <div className="header">
        <h3>Datos variables por departamento</h3>
        <div className="header-actions">
          <button onClick={() => void saveAll()} disabled={invoices.length === 0}>
            <span className="material-symbols-outlined">save</span> Guardar todo
          </button>
        </div>
      </div>
      {message && <div className="import-summary" style={{ marginBottom: '0.75rem' }}><span>{message}</span></div>}
      {error && <div className="error-message">{error}</div>}
      <div className="module-example" style={{ marginBottom: '0.75rem' }}>
        <span className="material-symbols-outlined">info</span>
        <span>
          Registra aquí los valores que cambian de un departamento a otro: lecturas del medidor de agua, consumo y el importe de cada concepto del mes. Luego usa esos datos para generar el recibo de cada departamento.
        </span>
      </div>

      <div className="condo-search-panel">
        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">apartment</span>
          <select value={towerId} onChange={e => setTowerId(e.target.value)}>
            {towers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
          </select>
        </div>
        <div className="search-bar" style={{ marginTop: '0.75rem' }}>
          <span className="material-symbols-outlined search-icon">calendar_month</span>
          <select value={periodId} onChange={e => { setPeriodId(e.target.value); }}>
            {billing.periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="loading-message">Cargando departamentos...</div>
      ) : invoices.length === 0 ? (
        <div className="empty-state"><p>No hay recibos en este período para la torre seleccionada. Genera los recibos del período primero.</p></div>
      ) : (
        <div className="variable-capture-list" style={{ marginTop: '0.75rem' }}>
          {slice.map(inv => (
            <div key={inv.id} className="module-card variable-capture-card">
              <div className="module-card-head">
                <div>
                  <h4>Torre {inv.departments?.towers?.code || '-'} · Dpto. {inv.departments?.department_number || '-'}</h4>
                  <p>Cuota base {fmtMoney(inv.amount)} · Conceptos variables subtotal {fmtMoney(itemSubtotal(inv))}</p>
                </div>
                <div className="module-head-actions">
                  <button className="icon-btn" title="Guardar este departamento" disabled={savingIds.has(inv.id)} onClick={() => void saveOne(inv)}>
                    <span className="material-symbols-outlined">{savingIds.has(inv.id) ? 'progress_activity' : 'save'}</span>
                  </button>
                </div>
              </div>

              <div className="receipt-editor-section-title">Lectura del medidor de agua</div>
              {variableOf(inv).meters.length === 0 && (
                <p className="text-muted" style={{ margin: '0.25rem 0' }}>Sin lecturas registradas.</p>
              )}
              {variableOf(inv).meters.map((m, idx) => (
                <div key={idx} className="form-row">
                  <div className="form-group" style={{ flex: 1 }}>
                    <input type="text" placeholder="Campo (Marca, Serie, Lectura anterior, Actual...)" value={m.label} onChange={e => setMeter(inv.id, idx, 'label', e.target.value)} />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <input type="text" placeholder="Valor" value={m.value} onChange={e => setMeter(inv.id, idx, 'value', e.target.value)} />
                  </div>
                  <button type="button" className="icon-btn danger" onClick={() => removeMeter(inv.id, idx)}><span className="material-symbols-outlined">close</span></button>
                </div>
              ))}
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn-cancel" onClick={() => addMeter(inv.id)}><span className="material-symbols-outlined">add</span> Agregar lectura</button>
              </div>

              <div className="receipt-editor-section-title">Conceptos del mes con importe variable</div>
              {variableOf(inv).items.map((it, idx) => (
                <div key={idx} className="receipt-item-row">
                  <div className="form-group" style={{ flex: 1.1 }}><input type="text" placeholder="Categoría" value={it.categoria} onChange={e => setItem(inv.id, idx, { categoria: e.target.value })} /></div>
                  <div className="form-group" style={{ flex: 2 }}><input type="text" placeholder="Descripción" value={it.descripcion} onChange={e => setItem(inv.id, idx, { descripcion: e.target.value })} /></div>
                  <div className="form-group" style={{ flex: 0.6 }}><input type="text" placeholder="Lectura/Unidad" value={it.cantidad || ''} onChange={e => setItem(inv.id, idx, { cantidad: e.target.value || null })} /></div>
                  <div className="form-group" style={{ flex: 0.6 }}><input type="number" placeholder="Total gasto" value={it.monto_total_gasto === null ? '' : String(it.monto_total_gasto)} onChange={e => setItem(inv.id, idx, { monto_total_gasto: e.target.value === '' ? null : Number(e.target.value) })} /></div>
                  <div className="form-group" style={{ flex: 0.6 }}><input type="number" placeholder="Importe dpto" value={String(it.importe_departamento)} onChange={e => setItem(inv.id, idx, { importe_departamento: Number(e.target.value) || 0 })} /></div>
                  <button type="button" className="icon-btn danger" onClick={() => removeItem(inv.id, idx)}><span className="material-symbols-outlined">close</span></button>
                </div>
              ))}
              <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="btn-cancel" onClick={() => addItem(inv.id)}><span className="material-symbols-outlined">add</span> Agregar concepto</button>
              </div>
            </div>
          ))}
          <PaginationBar
            total={invoices.length}
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