import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useBillingMaintenance } from '../hooks/useBillingMaintenance';
import { BillingReceiptEditor } from './BillingReceiptEditor';
import { MorososView } from './MorososView';
import { VariableDataCapture } from './VariableDataCapture';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { Tower, BillingInvoice, BillingFine, MaintenanceReceipt, Resident } from '../types';

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

function buildReceiptDefault(invoice: BillingInvoice, titular: string, condominioName: string): MaintenanceReceipt {
  const towerCode = invoice.departments?.towers?.code || '';
  const deptNumber = invoice.departments?.department_number || '';
  const today = new Date().toISOString().slice(0, 10);
  const items: MaintenanceReceipt['items'] = [];

  const variable = invoice.variable_data;
  const variableItems = variable?.items && Array.isArray(variable.items) && variable.items.length > 0
    ? variable.items.filter(it => it.descripcion || it.importe_departamento)
    : [];

  if (variableItems.length > 0) {
    for (const it of variableItems) {
      items.push({
        categoria: it.categoria || 'CONCEPTOS',
        descripcion: it.descripcion || 'Concepto del período',
        cantidad: it.cantidad ?? null,
        monto_total_gasto: it.monto_total_gasto ?? null,
        importe_departamento: Number(it.importe_departamento) || 0
      });
    }
  } else {
    for (const fine of (invoice.fines || [])) {
      items.push({ categoria: 'MULTAS', descripcion: fine.concept, cantidad: null, monto_total_gasto: null, importe_departamento: fine.amount });
    }
    items.push({
      categoria: 'CUOTA DE MANTENIMIENTO',
      descripcion: invoice.cycles?.label || 'Cuota de mantenimiento del período',
      cantidad: null,
      monto_total_gasto: null,
      importe_departamento: invoice.amount
    });
  }

  const subtotal = items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
  const marcas_agua = variable?.meters && Array.isArray(variable.meters)
    ? variable.meters.filter(m => m.label || m.value)
    : [];

  return {
    numero_recibo: `RCP-${(invoice.id || '').slice(0, 12).toUpperCase()}`,
    periodo: invoice.cycles?.label || 'Período',
    fecha_emision: invoice.created_at ? invoice.created_at.slice(0, 10) : today,
    fecha_vencimiento: invoice.due_date,
    moneda: 'Soles (PEN)',
    simbolo_moneda: 'S/',
    subtotal,
    ajustes: 0,
    total_mes: subtotal,
    deuda_total_acumulada: Math.max(0, invoice.total - invoice.paid_amount),
    estado_morosidad: invoice.status === 'PAGADA'
      ? 'FELICITACIONES, sus pagos están al día'
      : 'Su cuota se encuentra dentro del plazo de pago',
    condominio: condominioName,
    titular,
    edificio: towerCode,
    departamento: deptNumber.replace(/\D/g, ''),
    identificador_vivienda: `${towerCode}${deptNumber.replace(/\D/g, '').padStart(3, '0')}`,
    codigo_recaudacion: ['CLM', towerCode, deptNumber.replace(/\D/g, '').padStart(3, '0')].filter(Boolean).join(''),
    plataforma_recaudacion: 'KASHIO (Multibanca)',
    items,
    marcas_agua,
    entidades_autorizadas: ['BCP', 'SCOTIABANK', 'BBVA', 'INTERBANK', 'KASNET'],
    regla_codigo_pago: 'CLM (código condominio) + E[Torre] + D[Departamento]. Ejemplo: CLME4D503',
    pasos_pago: [
      'Ingresar a la banca por internet o aplicación móvil de su banco.',
      'Seleccionar la opción Pago de servicios.',
      'Buscar la empresa recaudadora: KASHIO.',
      'Ingresar el código único de su departamento.',
      'Confirmar el monto y realizar el pago.',
      'El sistema registrará automáticamente el pago a nombre de su departamento.'
    ],
    notas_pago: [
      'Los pagos deben realizarse únicamente a través del sistema KASHIO para no figurar en morosidad.',
      'Toda deuda anterior a la gestión fue cargada en KASHIO.'
    ],
    acciones_del_mes: [],
    contacto_soporte: 'Administración vía WhatsApp',
    plataforma_software: 'edificia.pe'
  };
}

const STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PARCIAL: 'Parcial',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada'
};

const STATUS_CLASS: Record<string, string> = {
  PENDIENTE: 'status-warn',
  PARCIAL: 'status-warn',
  PAGADA: 'status-occupied',
  ANULADA: 'status-vacant'
};

const FINE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  PAGADA: 'Pagada',
  ANULADA: 'Anulada'
};

type BillingTab = 'periods' | 'invoices' | 'fines' | 'morosos' | 'variables';

export function BillingManager({ schemaName, enabled }: { schemaName?: string; enabled?: boolean }) {
  const billing = useBillingMaintenance(schemaName, enabled);
  const [tab, setTab] = useState<BillingTab>('periods');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [configForm, setConfigForm] = useState({ default_fee: 150, due_days: 5, autolink_cart_fines: true });

  const [showPeriodModal, setShowPeriodModal] = useState(false);
  const [periodForm, setPeriodForm] = useState({ label: '', start_date: '', end_date: '', due_date: '', amount: '' });
  const [savingPeriod, setSavingPeriod] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const [towers, setTowers] = useState<Tower[]>([]);
  const [filters, setFilters] = useState({ period_id: '', status: '', department_id: '', tower_id: '', search: '' });
  const [invoicesPage, setInvoicesPage] = useState(1);
  const [invoicesPerPage, setInvoicesPerPage] = useState<number | 'all'>(10);

  const [showFeeModal, setShowFeeModal] = useState(false);
  const [feeForm, setFeeForm] = useState({ department_id: '', amount: '', is_exempt: false, notes: '' });
  const [savingFee, setSavingFee] = useState(false);

  const [showFineModal, setShowFineModal] = useState(false);
  const [fineForm, setFineForm] = useState({ department_id: '', concept: '', amount: '' });
  const [savingFine, setSavingFine] = useState(false);
  const [finesPage, setFinesPage] = useState(1);
  const [finesPerPage, setFinesPerPage] = useState<number | 'all'>(10);
  const [payingFineId, setPayingFineId] = useState<string | null>(null);
  const [syncingCart, setSyncingCart] = useState(false);
  const { condominium } = useCondominium();
  const [receiptEditing, setReceiptEditing] = useState<BillingInvoice | null>(null);
  const [receiptInitial, setReceiptInitial] = useState<MaintenanceReceipt | null>(null);

  useEffect(() => {
    if (!schemaName) return;
    let cancelled = false;
    invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } })
      .then((t) => {
        if (cancelled) return;
        setTowers((t.data?.data || []).sort((a, b) => a.code.localeCompare(b.code)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [schemaName]);

  useEffect(() => {
    if (billing.config) {
      setConfigForm({
        default_fee: Number(billing.config.default_fee) || 150,
        due_days: Number(billing.config.due_days) || 5,
        autolink_cart_fines: billing.config.autolink_cart_fines !== false
      });
    }
  }, [billing.config]);

  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [fines, setFines] = useState<BillingFine[]>([]);

  const loadInvoices = async (override?: Partial<typeof filters>) => {
    const f = { ...filters, ...override };
    setFilters(f);
    try {
      const list = await billing.fetchInvoices({ period_id: f.period_id || undefined, status: f.status || undefined, department_id: f.department_id || undefined });
      setInvoices(list);
      setInvoicesPage(1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar recibos');
    }
  };

  const selectedPeriodId = filters.period_id || billing.periods[0]?.id || '';

  useEffect(() => {
    if (!selectedPeriodId) return;
    loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  const loadFines = async (departmentId?: string) => {
    try {
      const list = await billing.fetchFines(departmentId);
      setFines(list);
      setFinesPage(1);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar multas');
    }
  };

  useEffect(() => {
    if (tab === 'fines') loadFines(filters.department_id || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.department_id]);

  useEffect(() => {
    if (tab === 'invoices' && selectedPeriodId) loadInvoices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, filters.status, filters.tower_id, filters.search]);

  const selectedTowerCode = towers.find(t => t.id === filters.tower_id)?.code || '';

  const filteredInvoices = invoices.filter(i => {
    if (filters.status && i.status !== filters.status) return false;
    if (filters.department_id && i.department_id !== filters.department_id) return false;
    if (filters.tower_id && i.departments?.towers?.code !== selectedTowerCode) return false;
    if (filters.search) {
      const dept = i.departments?.department_number || '';
      if (!dept.toLowerCase().includes(filters.search.toLowerCase())) return false;
    }
    return true;
  });

  const openPeriodModal = () => {
    const next = new Date();
    const monthLabel = next.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
    const start = new Date(next.getFullYear(), next.getMonth(), 1);
    const end = new Date(next.getFullYear(), next.getMonth() + 1, 0);
    setPeriodForm({
      label: `Cuota de mantenimiento - ${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}`,
      start_date: start.toISOString().slice(0, 10),
      end_date: end.toISOString().slice(0, 10),
      due_date: '',
      amount: String(configForm.default_fee || 150)
    });
    setShowPeriodModal(true);
  };

  const handleCreatePeriod = async () => {
    if (!periodForm.label.trim() || !periodForm.start_date || !periodForm.end_date) {
      setError('Completa el nombre y el rango de fechas del período.');
      return;
    }
    setSavingPeriod(true);
    setError(null);
    try {
      await billing.createPeriod({
        label: periodForm.label.trim(),
        start_date: periodForm.start_date,
        end_date: periodForm.end_date,
        ...(periodForm.due_date ? { due_date: periodForm.due_date } : {}),
        ...(periodForm.amount ? { amount: Number(periodForm.amount) } : {})
      });
      setShowPeriodModal(false);
      setFilters({ ...filters, period_id: billing.periods[0]?.id || '' });
      setMessage('Período creado y recibos generados');
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear el período');
    } finally {
      setSavingPeriod(false);
    }
  };

  const handleGenerateInvoices = async (periodId: string, regenerate = false) => {
    if (regenerate && !confirm('¿Regenerar todos los recibos del período? Se eliminarán los recibos, multas y pagos existentes de este período para volver a generarlos desde cero. Esta acción no se puede deshacer.')) return;
    setGeneratingId(periodId);
    setError(null);
    try {
      const created = regenerate
        ? await billing.regenerateInvoices(periodId)
        : await billing.generateInvoices(periodId);
      await billing.fetchAll();
      await loadInvoices();
      setMessage(regenerate ? `Recibos regenerados (${created} recibos)` : `Recibos generados (${created} recibos)`);
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al generar recibos');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleDeletePeriod = async (p: { id: string; label: string; stats?: { total_invoices: number; paid_invoices: number } }) => {
    const count = p.stats ? p.stats.total_invoices : 0;
    const paid = p.stats ? p.stats.paid_invoices : 0;
    const extra = paid > 0
      ? ` Este período tiene ${paid} recibo(s) pagado(s) que también se eliminarán.`
      : '';
    if (!confirm(`¿Eliminar el período "${p.label}" y sus ${count} recibo(s)?${extra} Esta acción no se puede deshacer.`)) return;
    setError(null);
    try {
      await billing.deletePeriod(p.id);
      setFilters({ ...filters, period_id: billing.periods[0]?.id || '' });
      setMessage(`Período "${p.label}" eliminado`);
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el período');
    }
  };

  const openFeeModal = () => {
    setFeeForm({ department_id: '', amount: String(configForm.default_fee || 150), is_exempt: false, notes: '' });
    setShowFeeModal(true);
  };

  const handleSaveFee = async () => {
    if (!feeForm.department_id) { setError('Selecciona un departamento.'); return; }
    setSavingFee(true);
    setError(null);
    try {
      await billing.setDepartmentFee({
        department_id: feeForm.department_id,
        amount: feeForm.is_exempt ? 0 : Number(feeForm.amount) || 0,
        is_exempt: feeForm.is_exempt,
        notes: feeForm.notes || undefined
      });
      setShowFeeModal(false);
      setMessage('Cuota del departamento actualizada');
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar la cuota');
    } finally {
      setSavingFee(false);
    }
  };

  const openFineModal = () => {
    setFineForm({ department_id: '', concept: '', amount: '' });
    setShowFineModal(true);
  };

  const handleAddFine = async () => {
    if (!fineForm.department_id || !fineForm.concept.trim() || !Number(fineForm.amount)) {
      setError('Selecciona un departamento, indica el concepto y el monto.');
      return;
    }
    setSavingFine(true);
    setError(null);
    try {
      await billing.addFine({
        department_id: fineForm.department_id,
        concept: fineForm.concept.trim(),
        amount: Number(fineForm.amount)
      });
      setShowFineModal(false);
      loadFines(filters.department_id || undefined);
      setMessage('Multa registrada');
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar la multa');
    } finally {
      setSavingFine(false);
    }
  };

  const handlePayFine = async (id: string) => {
    if (!confirm('¿Marcar esta multa como pagada?')) return;
    setPayingFineId(id);
    setError(null);
    try {
      await billing.payFine(id);
      loadFines(filters.department_id || undefined);
      setMessage('Multa pagada');
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al pagar la multa');
    } finally {
      setPayingFineId(null);
    }
  };

  const handlePayInvoice = async (inv: BillingInvoice) => {
    const amountStr = prompt(`Monto a pagar para ${inv.departments?.department_number || ''} (${fmtMoney(inv.total)}):`, String(inv.total));
    if (amountStr === null) return;
    const amount = Number(amountStr);
    if (!amount || amount <= 0) { setError('Monto inválido.'); return; }
    setError(null);
    try {
      await billing.registerPayment({ invoice_id: inv.id, amount });
      await loadInvoices();
      setMessage('Pago registrado');
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar el pago');
    }
  };

  const handleSyncCart = async () => {
    if (!confirm('¿Sincronizar las multas de carritos pendientes al estado de cuenta?')) return;
    setSyncingCart(true);
    setError(null);
    try {
      const created = await billing.syncCartFines();
      setMessage(`Se vincularon ${created} multa(s) de carritos`);
      if (tab === 'fines') loadFines();
      setTimeout(() => setMessage(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al sincronizar');
    } finally {
      setSyncingCart(false);
    }
  };

  const openReceipt = async (inv: BillingInvoice) => {
    document.body.classList.add('printing-receipt');
    // Resolve registered data that must always reflect the department: titular
    // from the primary resident, condominium from the tenant context, and the
    // tower/department from the invoice's registered department.
    let titular = '';
    if (schemaName) {
      try {
        const { data } = await invokeFunction<{ success: boolean; data: Resident[] | null }>('residents', {
          method: 'POST',
          body: { action: 'list', schema_name: schemaName, department_id: inv.department_id }
        });
        const residents = data?.data || [];
        const primary = residents.find(r => r.is_primary_contact) || residents[0];
        titular = primary?.full_name || '';
      } catch { /* keep empty */ }
    }
    const towerCode = inv.departments?.towers?.code || '';
    const deptNumber = inv.departments?.department_number || '';
    const registered = {
      condominio: condominium?.name || '',
      titular,
      edificio: towerCode,
      departamento: deptNumber.replace(/\D/g, ''),
      identificador_vivienda: `${towerCode}${deptNumber.replace(/\D/g, '').padStart(3, '0')}`
    };
    const base = inv.receipt_data
      ? { ...inv.receipt_data, ...registered }
      : buildReceiptDefault(inv, titular, condominium?.name || '');
    setReceiptInitial(base);
    setReceiptEditing(inv);
  };

  const closeReceipt = () => {
    document.body.classList.remove('printing-receipt');
    setReceiptEditing(null);
    setReceiptInitial(null);
  };

  const handleSaveReceipt = async (data: MaintenanceReceipt) => {
    if (!receiptEditing) return;
    await billing.saveReceipt(receiptEditing.id, data);
    setMessage('Recibo guardado');
    setTimeout(() => setMessage(null), 2500);
    // Reload the invoices so the listing reflects the saved receipt
    if (selectedPeriodId) await loadInvoices();
  };

  if (!enabled) return null;
  if (billing.loading) return <div className="loading-message">Cargando facturación...</div>;

  const { slice: pagedInvoices } = paginate(filteredInvoices, invoicesPage, invoicesPerPage === 'all' ? filteredInvoices.length : invoicesPerPage);
  const { slice: pagedFines } = paginate(fines, finesPage, finesPerPage === 'all' ? fines.length : finesPerPage);

  const feeFor = (deptId: string) => billing.departmentFees.find(f => f.department_id === deptId);

  const formatDate = (d: string) => {
    const date = new Date(d);
    return isNaN(date.getTime()) ? d : date.toLocaleDateString('es-PE');
  };

  return (
    <div className="billing-manager">
      <div className="header">
        <h3>Facturación y Mantenimiento</h3>
        <div className="header-actions">
          <button onClick={handleSyncCart} disabled={syncingCart} title="Vincular al estado de cuenta las multas de carritos pendientes">
            <span className="material-symbols-outlined">sync</span> {syncingCart ? 'Sincronizando...' : 'Sincronizar multas de carritos'}
          </button>
          {tab === 'periods' && <button onClick={openPeriodModal}><span className="material-symbols-outlined">add</span> Crear período</button>}
          {tab === 'invoices' && (
            <>
              <button onClick={() => selectedPeriodId && handleGenerateInvoices(selectedPeriodId)} disabled={!selectedPeriodId || generatingId !== null}>
                <span className="material-symbols-outlined">receipt_long</span> {generatingId ? 'Generando...' : 'Generar recibos'}
              </button>
              <button className="btn-cancel" onClick={() => selectedPeriodId && handleGenerateInvoices(selectedPeriodId, true)} disabled={!selectedPeriodId || generatingId !== null} title="Elimina y vuelve a generar todos los recibos del período (para corregir errores)">
                <span className="material-symbols-outlined">refresh</span> {generatingId ? 'Regenerando...' : 'Regenerar recibos'}
              </button>
            </>
          )}
          {tab === 'fines' && <button onClick={openFineModal}><span className="material-symbols-outlined">add</span> Registrar multa</button>}
          <button onClick={openFeeModal}><span className="material-symbols-outlined">tune</span> Cuota por departamento</button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}
      {message && <div className="import-summary" style={{ marginBottom: '0.75rem' }}><span>{message}</span></div>}

      <div className="setup-tabs" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'periods' ? 'active' : ''} onClick={() => setTab('periods')}>Períodos</button>
        <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}>Recibos</button>
        <button className={tab === 'fines' ? 'active' : ''} onClick={() => setTab('fines')}>Multas</button>
        <button className={tab === 'morosos' ? 'active' : ''} onClick={() => setTab('morosos')}>Morosos</button>
        <button className={tab === 'variables' ? 'active' : ''} onClick={() => setTab('variables')}>Datos variables</button>
      </div>

      {tab === 'morosos' && (
        <MorososView schemaName={schemaName} enabled />
      )}

      {tab === 'variables' && (
        <VariableDataCapture schemaName={schemaName} enabled />
      )}

      {tab === 'periods' && (
        billing.periods.length === 0 ? (
          <div className="empty-state"><p>No hay períodos de facturación. Crea un período para generar los recibos de cuotas de mantenimiento.</p></div>
        ) : (
          <div className="modules-grid">
            {billing.periods.map(p => (
              <div key={p.id} className="module-card">
                <div className="module-card-head">
                  <div>
                    <h4>{p.label}</h4>
                    <p>{formatDate(p.start_date)} → {formatDate(p.end_date)} · Vence {formatDate(p.due_date)}</p>
                  </div>
                  <span className={`status-badge ${p.is_closed ? 'status-vacant' : 'status-occupied'}`}>{p.is_closed ? 'Cerrado' : 'Abierto'}</span>
                </div>
                <div className="board-notes text-muted" style={{ marginTop: '0.3rem' }}>
                  {p.stats ? (
                    <>
                      {p.stats.total_invoices} recibo(s) · {p.stats.paid_invoices} pagado(s) · {p.stats.morosos} moroso(s) ·{' '}
                      <strong>{fmtMoney(p.stats.collected)}</strong> cobrado
                    </>
                  ) : 'Sin recibos generados'}
                </div>
                <div className="condo-card-actions" style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border,#e5e7eb)', justifyContent: 'flex-start' }}>
                  <button onClick={() => { setFilters({ ...filters, period_id: p.id }); setTab('invoices'); }}><span className="material-symbols-outlined">receipt_long</span> Ver recibos</button>
                  <button className="btn-cancel" title="Elimina el período con todos sus recibos, multas y pagos" onClick={() => handleDeletePeriod(p)}>
                    <span className="material-symbols-outlined">delete</span> Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'invoices' && (
        <>
          <div className="search-bar" style={{ marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined search-icon">filter_list</span>
            <select value={filters.period_id} onChange={e => { setFilters({ ...filters, period_id: e.target.value }); }}>
              {billing.periods.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="condo-search-panel">
            <div className="search-bar">
              <span className="material-symbols-outlined search-icon">search</span>
              <input type="text" placeholder="Buscar por departamento o torre..." value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} />
            </div>
            <div className="search-bar" style={{ marginTop: '0.75rem' }}>
              <span className="material-symbols-outlined search-icon">filter_list</span>
              <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
                <option value="">Todos los estados</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="search-bar" style={{ marginTop: '0.75rem' }}>
              <span className="material-symbols-outlined search-icon">apartment</span>
              <select value={filters.tower_id} onChange={e => setFilters({ ...filters, tower_id: e.target.value })}>
                <option value="">Todas las torres</option>
                {towers.map(t => <option key={t.id} value={t.id}>{t.name} ({t.code})</option>)}
              </select>
            </div>
          </div>

          {filteredInvoices.length === 0 ? (
            <div className="empty-state"><p>No hay recibos para este filtro. Genera los recibos del período si aún no existen.</p></div>
          ) : (
            <>
              <div className="users-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Torre</th>
                      <th>Departamento</th>
                      <th>Cuota</th>
                      <th>Multas</th>
                      <th>Total</th>
                      <th>Pagado</th>
                      <th>Estado</th>
                      <th>Vencimiento</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedInvoices.map(inv => (
                      <tr key={inv.id}>
                        <td>{inv.departments?.towers?.code || '-'}</td>
                        <td>{inv.departments?.department_number || '-'}</td>
                        <td>{fmtMoney(inv.amount)}</td>
                        <td>{fmtMoney(inv.fine_total)}</td>
                        <td><strong>{fmtMoney(inv.total)}</strong></td>
                        <td>{fmtMoney(inv.paid_amount)}</td>
                        <td><span className={`status-badge ${STATUS_CLASS[inv.status] || ''}`}>{STATUS_LABELS[inv.status] || inv.status}</span></td>
                        <td>{formatDate(inv.due_date)}</td>
                        <td>
                          <div className="condo-card-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', justifyContent: 'flex-start' }}>
                            <button className="icon-btn" title="Crear o editar el recibo de mantenimiento" onClick={() => openReceipt(inv)}>
                              <span className="material-symbols-outlined">receipt_long</span>
                            </button>
                            {inv.status !== 'PAGADA' && (
                              <button className="icon-btn" title="Registrar pago" onClick={() => handlePayInvoice(inv)}>
                                <span className="material-symbols-outlined">payments</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                total={filteredInvoices.length}
                page={invoicesPage}
                perPage={invoicesPerPage}
                onPageChange={setInvoicesPage}
                onPerPageChange={n => setInvoicesPerPage(n)}
                itemLabel="recibo"
              />
            </>
          )}
        </>
      )}

      {tab === 'fines' && (
        <>
          <div className="search-bar" style={{ marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined search-icon">filter_list</span>
            <select value={filters.department_id} onChange={e => setFilters({ ...filters, department_id: e.target.value })}>
              <option value="">Todos los departamentos</option>
              {billing.departmentFees.map(d => <option key={d.department_id} value={d.department_id}>{d.department_number} · {d.tower?.code || ''}</option>)}
            </select>
          </div>
          {pagedFines.length === 0 ? (
            <div className="empty-state"><p>No hay multas registradas. Usa «Sincronizar multas de carritos» o registra una multa operativa manualmente.</p></div>
          ) : (
            <>
              <div className="users-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Departamento</th>
                      <th>Torre</th>
                      <th>Origen</th>
                      <th>Concepto</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedFines.map(f => (
                      <tr key={f.id}>
                        <td>{f.departments?.department_number || '-'}</td>
                        <td>{f.departments?.towers?.code || '-'}</td>
                        <td>{f.source === 'CART_LOAN' ? 'Carrito' : 'Operativa'}</td>
                        <td>{f.concept}</td>
                        <td>{fmtMoney(f.amount)}</td>
                        <td><span className={`status-badge ${f.status === 'PAGADA' ? 'status-occupied' : f.status === 'PENDIENTE' ? 'status-warn' : 'status-vacant'}`}>{FINE_STATUS_LABELS[f.status] || f.status}</span></td>
                        <td>{formatDate(f.created_at)}</td>
                        <td>
                          {f.status === 'PENDIENTE' && (
                            <button className="icon-btn" title="Pagar multa" disabled={payingFineId === f.id} onClick={() => handlePayFine(f.id)}>
                              <span className="material-symbols-outlined">payments</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                total={fines.length}
                page={finesPage}
                perPage={finesPerPage}
                onPageChange={setFinesPage}
                onPerPageChange={n => setFinesPerPage(n)}
                itemLabel="multa"
              />
            </>
          )}
        </>
      )}

      {showPeriodModal && (
        <div className="modal-overlay" onClick={() => setShowPeriodModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Crear período de facturación</h3>
                <p className="text-on-surface-variant">Genera los recibos de cuota de mantenimiento para todos los departamentos.</p>
              </div>
              <button className="modal-close" onClick={() => setShowPeriodModal(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group"><label>Nombre del período</label><input type="text" value={periodForm.label} onChange={e => setPeriodForm({ ...periodForm, label: e.target.value })} /></div>
              <div className="form-row">
                <div className="form-group"><label>Inicio</label><input type="date" value={periodForm.start_date} onChange={e => setPeriodForm({ ...periodForm, start_date: e.target.value })} /></div>
                <div className="form-group"><label>Fin</label><input type="date" value={periodForm.end_date} onChange={e => setPeriodForm({ ...periodForm, end_date: e.target.value })} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Vencimiento (opcional)</label><input type="date" value={periodForm.due_date} onChange={e => setPeriodForm({ ...periodForm, due_date: e.target.value })} /></div>
                <div className="form-group"><label>Cuota aplicada (opcional)</label><input type="number" min={0} value={periodForm.amount} onChange={e => setPeriodForm({ ...periodForm, amount: e.target.value })} /></div>
              </div>
              {error && <div className="error-message">{error}</div>}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowPeriodModal(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                <button onClick={handleCreatePeriod} disabled={savingPeriod}><span className="material-symbols-outlined">add</span> {savingPeriod ? 'Creando...' : 'Crear y generar recibos'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFeeModal && (
        <div className="modal-overlay" onClick={() => setShowFeeModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Cuota de mantenimiento por departamento</h3>
                <p className="text-on-surface-variant">Personaliza o exonera la cuota de un departamento.</p>
              </div>
              <button className="modal-close" onClick={() => setShowFeeModal(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Departamento</label>
                <select value={feeForm.department_id} onChange={e => setFeeForm({ ...feeForm, department_id: e.target.value })}>
                  <option value="">Seleccionar departamento...</option>
                  {billing.departmentFees.map(d => (
                    <option key={d.department_id} value={d.department_id}>
                      {d.department_number} · {d.tower?.code || ''}{d.is_exempt ? ' · Exento' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {feeForm.department_id && feeFor(feeForm.department_id)?.is_exempt && (
                <div className="module-example"><span className="material-symbols-outlined">info</span><span>Este departamento está exento de pago actualmente.</span></div>
              )}
              <div className="form-group">
                <label>Monto (S/)</label>
                <input type="number" min={0} value={feeForm.amount} disabled={feeForm.is_exempt} onChange={e => setFeeForm({ ...feeForm, amount: e.target.value })} />
              </div>
              <div className="form-group">
                <label>
                  <input type="checkbox" checked={feeForm.is_exempt} onChange={e => setFeeForm({ ...feeForm, is_exempt: e.target.checked })} />
                  Exonerar del pago de mantenimiento
                </label>
              </div>
              <div className="form-group"><label>Notas</label><input type="text" value={feeForm.notes} onChange={e => setFeeForm({ ...feeForm, notes: e.target.value })} placeholder="Motivo o observación" /></div>
              {error && <div className="error-message">{error}</div>}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowFeeModal(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                <button onClick={handleSaveFee} disabled={savingFee}><span className="material-symbols-outlined">save</span> {savingFee ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFineModal && (
        <div className="modal-overlay" onClick={() => setShowFineModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Registrar multa operativa</h3>
                <p className="text-on-surface-variant">Asigna una multa manual al estado de cuenta del departamento.</p>
              </div>
              <button className="modal-close" onClick={() => setShowFineModal(false)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Departamento</label>
                <select value={fineForm.department_id} onChange={e => setFineForm({ ...fineForm, department_id: e.target.value })}>
                  <option value="">Seleccionar departamento...</option>
                  {billing.departmentFees.map(d => (
                    <option key={d.department_id} value={d.department_id}>{d.department_number} · {d.tower?.code || ''}</option>
                  ))}
                </select>
              </div>
              <div className="form-group"><label>Concepto</label><input type="text" value={fineForm.concept} onChange={e => setFineForm({ ...fineForm, concept: e.target.value })} placeholder="Ej: Multa por incumplimiento de reglas" /></div>
              <div className="form-group"><label>Monto (S/)</label><input type="number" min={0.01} step="0.01" value={fineForm.amount} onChange={e => setFineForm({ ...fineForm, amount: e.target.value })} /></div>
              {error && <div className="error-message">{error}</div>}
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowFineModal(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
                <button onClick={handleAddFine} disabled={savingFine}><span className="material-symbols-outlined">add</span> {savingFine ? 'Registrando...' : 'Registrar multa'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {receiptEditing && (
        <div className="modal-overlay receipt-editor-overlay">
          <div className="modal-content receipt-editor-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Recibo de mantenimiento</h3>
                <p className="text-on-surface-variant">
                  Torre {receiptEditing.tower_code || receiptEditing.departments?.towers?.code || '-'} · Dpto. {receiptEditing.department_number || receiptEditing.departments?.department_number || ''} · {receiptEditing.cycles?.label || ''}
                  {receiptInitial ? ' — ingresa los datos variables y guarda' : ''}
                </p>
              </div>
              <button className="modal-close" onClick={closeReceipt} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <BillingReceiptEditor
                invoice={receiptEditing}
                initial={receiptInitial}
                onSave={handleSaveReceipt}
                onClose={closeReceipt}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}