import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCartLending } from '../hooks/useCartLending';
import { useCondoGates } from '../hooks/useCondoGates';
import type { Cart, CartLoan, CartLendingConfig, Department, Gate, Tower } from '../types';

interface DeptOption {
  id: string;
  label: string;
}

function fmtMinutes(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

const CART_TYPE_LABELS: Record<string, string> = { CARGA: 'Carro de carga', COMPRA: 'Coche de compras' };

export function GaritaManager({ schemaName }: { schemaName?: string }) {
  const { listCarts, listLoans, checkout, checkin } = useCartLending();
  const { list: listGates } = useCondoGates();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loans, setLoans] = useState<CartLoan[]>([]);
  const [config, setConfig] = useState<CartLendingConfig | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [checkoutCartId, setCheckoutCartId] = useState('');
  const [checkoutDeptId, setCheckoutDeptId] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);

  const loadCarts = useCallback(async () => {
    if (!schemaName) return [];
    const c = await listCarts(schemaName);
    setCarts(c);
    return c;
  }, [schemaName, listCarts]);

  const loadLoans = useCallback(async () => {
    if (!schemaName) return;
    const lr = await listLoans(schemaName, true);
    setLoans(lr.loans);
    setConfig(lr.config);
  }, [schemaName, listLoans]);

  useEffect(() => {
    if (!schemaName) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([loadCarts(), loadLoans(), listGates(schemaName).then(setGates)]);
        const deptRes = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
        const towerRes = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
        if (cancelled) return;
        const deptData: Department[] = deptRes?.data?.data || [];
        const towerData: Tower[] = towerRes?.data?.data || [];
        const towerCode = new Map(towerData.map(t => [t.id, t.code]));
        setDeptOptions(deptData.map(d => ({
          id: d.id,
          label: `Dpto ${d.department_number}${towerCode.get(d.tower_id) ? ` (Torre ${towerCode.get(d.tower_id)})` : ''}`
        })));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schemaName, loadCarts, loadLoans, listGates]);

  const refreshAll = async () => {
    if (!schemaName) return;
    await Promise.all([loadCarts(), loadLoans(), listGates(schemaName).then(setGates)]);
  };

  const handleCheckout = async () => {
    if (!schemaName) return;
    if (!checkoutCartId || !checkoutDeptId) { alert('Seleccione carrito y departamento'); return; }
    setCheckoutBusy(true);
    setError(null);
    try {
      const loan = await checkout(schemaName, checkoutCartId, checkoutDeptId);
      setMessage(`Préstamo registrado${loan && loan.due_time ? ` — vence ${new Date(loan.due_time).toLocaleString('es-PE')}` : ''}`);
      setCheckoutCartId('');
      setCheckoutDeptId('');
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleCheckin = async (loan: CartLoan) => {
    if (!schemaName) return;
    if (!confirm(`¿Registrar la devolución del carrito ${loan.cart_code || ''}?`)) return;
    setCheckinBusyId(loan.id);
    setError(null);
    try {
      const result = await checkin(schemaName, loan.id);
      if (result && result.penalty_amount > 0) {
        alert(`Carrito devuelto con retraso. Multa generada: ${fmtMoney(result.penalty_amount)}`);
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setCheckinBusyId(null);
    }
  };

  if (loading) return <div className="loading-message">Cargando garita...</div>;

  const availableCarts = carts.filter(c => c.status === 'DISPONIBLE');
  const activeLoans = loans.filter(l => l.status === 'ACTIVO');
  const prestados = carts.filter(c => c.status === 'PRESTADO').length;
  const mantenimiento = carts.filter(c => c.status === 'MANTENIMIENTO').length;
  const disponibles = carts.filter(c => c.status === 'DISPONIBLE').length;
  const activeGates = gates.filter(g => g.is_active);

  return (
    <div className="cart-lending-manager">
      <div className="modules-header">
        <h3>Panel de Garita</h3>
        {config && (
          <small>
            Préstamo máx: {config.max_loan_minutes} min · Gracia: {config.grace_period_minutes} min · Multa: {fmtMoney(config.fine_amount)} cada {config.fine_interval_minutes} min · Puertas: {gates.length}
            {config.fine_enabled ? '' : ' (multas desactivadas)'}
          </small>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="cart-estado">
        <div className="cart-kpi-row">
          <div className="cart-kpi"><span className="material-symbols-outlined">shopping_cart</span><strong>{carts.length}</strong> carritos</div>
          <div className="cart-kpi cart-kpi-dispo"><span className="material-symbols-outlined">check_circle</span><strong>{disponibles}</strong> disponibles</div>
          <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">swap_horiz</span><strong>{prestados}</strong> prestados</div>
          <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">build</span><strong>{mantenimiento}</strong> en mantenimiento</div>
        </div>

        {activeGates.length > 0 && (
          <div className="cart-gates">
            <h4>Carritos por puerta</h4>
            <div className="cart-gate-grid">
              {activeGates.map(g => {
                const gateCarts = carts.filter(c => c.gate_id === g.id);
                const carga = gateCarts.filter(c => c.cart_type === 'CARGA');
                const compra = gateCarts.filter(c => c.cart_type === 'COMPRA');
                const prestadosGate = gateCarts.filter(c => c.status === 'PRESTADO').length;
                return (
                  <div key={g.id} className="cart-gate-card">
                    <span className="cart-gate-num">{g.name}</span>
                    <span>Carros de carga: {carga.length} / {g.carts_carga}</span>
                    <span>Coches de compras: {compra.length} / {g.carts_compra}</span>
                    <span className={prestadosGate > 0 ? 'cart-gate-prestado' : ''}>{prestadosGate > 0 ? `${prestadosGate} prestado(s)` : 'Sin préstamos'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="cart-checkout-form">
          <h4>Registrar Préstamo</h4>
          <p className="cart-checkout-hint">Se registra la torre y el departamento del residente que toma el carrito.</p>
          <div className="form-row">
            <div className="form-group">
              <label>Carrito</label>
              <select value={checkoutCartId} onChange={e => setCheckoutCartId(e.target.value)}>
                <option value="">Seleccionar...</option>
                {availableCarts.map(c => <option key={c.id} value={c.id}>{c.code_identifier}{c.gate?.name ? ` (${c.gate.name})` : ''} · {CART_TYPE_LABELS[c.cart_type || 'CARGA']}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Departamento del residente</label>
              <select value={checkoutDeptId} onChange={e => setCheckoutDeptId(e.target.value)}>
                <option value="">Seleccionar...</option>
                {deptOptions.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button onClick={handleCheckout} disabled={checkoutBusy || availableCarts.length === 0 || deptOptions.length === 0}>
              {checkoutBusy ? 'Prestado...' : 'Prestar'}
            </button>
          </div>
        </div>

        <div className="cart-loans-table">
          <h4>Carritos prestados</h4>
          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Carrito</th>
                <th>Torre</th>
                <th>Depto</th>
                <th>Desde</th>
                <th>Tiempo</th>
                <th>Vence</th>
                <th>Multa estimada</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {activeLoans.length === 0 ? (
                <tr><td colSpan={8} className="empty-text">No hay carritos prestados.</td></tr>
              ) : activeLoans.map(l => (
                <tr key={l.id}>
                  <td>{l.cart_code || '-'}{l.cart_gate?.name ? ` (${l.cart_gate.name})` : ''}</td>
                  <td>{l.tower_code || '-'}</td>
                  <td>{l.department_number || '-'}</td>
                  <td>{new Date(l.checkout_time).toLocaleString('es-PE')}</td>
                  <td>{fmtMinutes(l.elapsed_minutes || 0)}</td>
                  <td>{new Date(l.due_time).toLocaleString('es-PE')}</td>
                  <td>
                    {(l.estimated_fine && l.estimated_fine > 0)
                      ? <span className="fines-tag">{fmtMoney(l.estimated_fine)}</span>
                      : <span className="text-muted">—</span>}
                  </td>
                  <td>
                    <button className="btn-primary" onClick={() => handleCheckin(l)} disabled={checkinBusyId === l.id}>
                      {checkinBusyId === l.id ? '...' : 'Devolución'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}