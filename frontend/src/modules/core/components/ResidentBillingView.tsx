import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useBillingMaintenance } from '../hooks/useBillingMaintenance';
import { BillingReceipt } from './BillingReceipt';
import type { BillingFine, BillingInvoice, BillingPayment, MaintenanceReceipt, Resident } from '../types';

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
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

export function ResidentBillingView({ schemaName, enabled }: { schemaName?: string; enabled?: boolean }) {
  const billing = useBillingMaintenance(schemaName, enabled);
  const { condominium } = useCondominium();
  const [state, setState] = useState<{ department_id: string; invoices: BillingInvoice[]; fines: BillingFine[] } | null>(null);
  const [payments, setPayments] = useState<BillingPayment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<MaintenanceReceipt | null>(null);

  useEffect(() => {
    if (!schemaName || !enabled) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await billing.fetchMyState();
        if (cancelled) return;
        setState(s || null);
        const p = await billing.fetchPayments(s?.department_id);
        if (!cancelled) setPayments(p);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de conexión');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schemaName, enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!enabled) return null;

  const formatDate = (d: string) => {
    const date = new Date(d);
    return isNaN(date.getTime()) ? d : date.toLocaleDateString('es-PE');
  };

  const unpaid = state ? state.invoices.filter(i => i.status !== 'PAGADA') : [];
  const totalPending = unpaid.reduce((s, i) => s + (i.total - i.paid_amount), 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);

  const buildReceipt = async (inv: BillingInvoice) => {
    const cycle = inv.cycles;
    const towerCode = inv.departments?.towers?.code || '';
    const deptNumber = inv.departments?.department_number || '';
    // Registered titular: primary resident of the department
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
    const items: MaintenanceReceipt['items'] = [{
      categoria: 'CUOTA DE MANTENIMIENTO',
      descripcion: cycle?.label || 'Cuota de mantenimiento',
      cantidad: null,
      monto_total_gasto: null,
      importe_departamento: inv.amount
    }];
    for (const fine of (inv.fines || [])) {
      items.push({ categoria: 'MULTAS', descripcion: fine.concept, cantidad: null, monto_total_gasto: null, importe_departamento: fine.amount });
    }
    const today = new Date().toISOString().slice(0, 10);
    const overdue = inv.status !== 'PAGADA' && inv.due_date < today;
    const estado = inv.status === 'PAGADA'
      ? 'FELICITACIONES, sus pagos están al día'
      : overdue ? 'ATENCIÓN: tiene pagos vencidos pendientes' : 'Su cuota se encuentra dentro del plazo de pago';
    const codigo = ['CLM', towerCode, deptNumber.replace(/\D/g, '').padStart(3, '0')].filter(Boolean).join('');
    setReceipt({
      numero_recibo: `RCP-${inv.id.slice(0, 12).toUpperCase()}`,
      periodo: cycle?.label || 'Período',
      fecha_emision: inv.created_at ? inv.created_at.slice(0, 10) : today,
      fecha_vencimiento: inv.due_date,
      moneda: 'Soles (PEN)',
      simbolo_moneda: 'S/',
      subtotal: inv.amount,
      ajustes: inv.fine_total || 0,
      total_mes: inv.total,
      deuda_total_acumulada: Math.max(0, inv.total - inv.paid_amount),
      estado_morosidad: estado,
      condominio: condominium?.name || '',
      titular,
      edificio: towerCode,
      departamento: deptNumber.replace(/\D/g, ''),
      identificador_vivienda: `${towerCode}${deptNumber.replace(/\D/g, '').padStart(3, '0')}`,
      codigo_recaudacion: codigo,
      plataforma_recaudacion: 'KASHIO (Multibanca)',
      items,
      marcas_agua: [],
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
        'Los pagos deben realizarse únicamente a través del sistema KASHIO para no figurar en morosidad.'
      ],
      acciones_del_mes: [],
      contacto_soporte: 'Administración vía WhatsApp',
      plataforma_software: 'edificia.pe'
    });
  };

  if (loading) return <div className="loading-message">Cargando tu estado de cuenta...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!state) return <div className="empty-state"><p>No se encontró un departamento vinculado a tu cuenta. Consulta con la administración.</p></div>;

  return (
    <div className="billing-manager">
      <div className="header">
        <div>
          <h3>Mi Facturación y Mantenimiento</h3>
          <p className="text-on-surface-variant">
            Torre {state.invoices[0]?.departments?.towers?.code || ''} · Dpto. {state.invoices[0]?.departments?.department_number || ''}
            {unpaid.length > 0 && <strong style={{ color: '#b26b00' }}> · Pendiente: {fmtMoney(totalPending)}</strong>}
          </p>
        </div>
      </div>

      <div className="modules-header">
        <h3>Estado de cuenta</h3>
        <small>Tus recibos de cuotas de mantenimiento generados por la administración.</small>
      </div>

      {state.invoices.length === 0 ? (
        <div className="empty-state"><p>No hay recibos generados para tu departamento todavía.</p></div>
      ) : (
        <div className="users-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Período</th>
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
              {state.invoices.map(inv => (
                <tr key={inv.id}>
                  <td>{inv.cycles?.label || '-'}</td>
                  <td>{fmtMoney(inv.amount)}</td>
                  <td>{fmtMoney(inv.fine_total)}</td>
                  <td><strong>{fmtMoney(inv.total)}</strong></td>
                  <td>{fmtMoney(inv.paid_amount)}</td>
                  <td><span className={`status-badge ${STATUS_CLASS[inv.status] || ''}`}>{STATUS_LABELS[inv.status] || inv.status}</span></td>
                  <td>{formatDate(inv.due_date)}</td>
                  <td>
                    <div className="condo-card-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', justifyContent: 'flex-start' }}>
                      <button className="icon-btn" title="Ver e imprimir recibo" onClick={() => void buildReceipt(inv)}>
                        <span className="material-symbols-outlined">print</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="modules-header" style={{ marginTop: '1.25rem' }}>
        <h3>Historial de pagos</h3>
        <small>Los pagos registrados por la administración a tu departamento.</small>
      </div>

      {payments.length === 0 ? (
        <div className="empty-state"><p>No hay pagos registrados todavía.</p></div>
      ) : (
        <div className="users-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Monto</th>
                <th>Recibo asociado</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>{formatDate(p.payment_date)}</td>
                  <td><strong>{fmtMoney(p.amount)}</strong></td>
                  <td>{p.invoices ? (p.invoices.status === 'PAGADA' ? 'Pago completo' : 'Pago parcial') : '-'}</td>
                  <td>{p.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="import-result-summary" style={{ marginTop: '0.75rem' }}>
            <div className="import-result-count"><span className="material-symbols-outlined">payments</span><span><strong>{fmtMoney(totalPaid)}</strong> pagado en total</span></div>
          </div>
        </div>
      )}

      {receipt && (
        <div className="modal-overlay receipt-modal-overlay" onClick={() => setReceipt(null)}>
          <div className="modal-content receipt-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Recibo de mantenimiento</h3>
                <p className="text-on-surface-variant">Vista previa lista para imprimir o exportar a PDF.</p>
              </div>
              <button className="modal-close" onClick={() => setReceipt(null)} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <BillingReceipt data={receipt} />
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setReceipt(null)}><span className="material-symbols-outlined">close</span> Cerrar</button>
                <button onClick={() => window.print()}><span className="material-symbols-outlined">print</span> Imprimir / Guardar PDF</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}