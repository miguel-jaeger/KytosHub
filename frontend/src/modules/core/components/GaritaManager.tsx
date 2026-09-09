import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCartLending } from '../hooks/useCartLending';
import { useCondoGates } from '../hooks/useCondoGates';
import { CartCheckoutForm } from './CartCheckoutForm';
import type { Cart, CartLoan, CartLendingConfig, Gate, Tower } from '../types';

function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

function computeFine(config: CartLendingConfig, overtimeMinutes: number): number {
  if (!config.fine_enabled || overtimeMinutes <= config.grace_period_minutes) return 0;
  const excess = overtimeMinutes - config.grace_period_minutes;
  if (config.fine_type === 'FIXED' || (config.fine_type === 'FIXED_OR_PER_INTERVAL' && excess <= config.fine_interval_minutes)) {
    return config.fine_amount;
  }
  return Math.ceil(excess / config.fine_interval_minutes) * config.fine_amount;
}

function loanStatus(now: number, loan: CartLoan, config: CartLendingConfig | null): { elapsedSec: number; remainingSec: number; overtimeMin: number; fine: number; severity: 'ok' | 'warning' | 'overdue' } {
  const checkoutMs = new Date(loan.checkout_time).getTime();
  const dueMs = new Date(loan.due_time).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - checkoutMs) / 1000));
  const remainingSec = Math.max(0, Math.floor((dueMs - now) / 1000));
  const overtimeMin = Math.max(0, Math.floor((now - dueMs) / 60000));
  const fine = config ? computeFine(config, overtimeMin) : 0;
  let severity: 'ok' | 'warning' | 'overdue' = 'ok';
  if (overtimeMin > 0) {
    severity = fine > 0 ? 'overdue' : 'warning';
  } else if (remainingSec <= 10 * 60) {
    severity = 'warning';
  }
  return { elapsedSec, remainingSec, overtimeMin, fine, severity };
}

export function GaritaManager({ schemaName }: { schemaName?: string }) {
  const { listCarts, listLoans, checkout, checkin } = useCartLending();
  const { list: listGates } = useCondoGates();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loans, setLoans] = useState<CartLoan[]>([]);
  const [config, setConfig] = useState<CartLendingConfig | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
        const towerRes = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
        if (cancelled) return;
        setTowers(towerRes?.data?.data || []);
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

  const handleCheckout = async (cartId: string, departmentId: string) => {
    if (!schemaName) return;
    setCheckoutBusy(true);
    setError(null);
    try {
      const loan = await checkout(schemaName, cartId, departmentId);
      setMessage(`Préstamo registrado${loan && loan.due_time ? ` — vence ${new Date(loan.due_time).toLocaleString('es-PE')}` : ''}`);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
      throw err;
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
                const typeSummary = (type: string, capacity: number) => {
                  const group = gateCarts.filter(c => c.cart_type === type);
                  const disp = group.filter(c => c.status === 'DISPONIBLE').length;
                  const prest = group.filter(c => c.status === 'PRESTADO').length;
                  const pct = capacity > 0 ? Math.min(100, Math.round((prest / capacity) * 100)) : 0;
                  return (
                    <div key={type} className="cart-gate-type">
                      <div className="cart-gate-type-head">
                        <span className="cart-gate-type-label">{type === 'CARGA' ? 'Carga' : 'Compras'}</span>
                        <span className="cart-gate-cap">Cap. {capacity}</span>
                      </div>
                      <div className={`cart-gate-bar${prest > 0 ? ' cart-gate-bar-used' : ''}`}>
                        <span style={{ width: `${pct}%` }} />
                      </div>
                      <div className="cart-gate-type-counts">
                        <span className="cart-gate-disp"><strong>{disp}</strong> disponibles</span>
                        <span className={`cart-gate-prestado${prest > 0 ? ' has' : ''}`}><strong>{prest}</strong> prestados</span>
                      </div>
                    </div>
                  );
                };
                return (
                  <article key={g.id} className="cart-gate-card">
                    <header className="cart-gate-head">
                      <div className="cart-gate-titles">
                        <span className="cart-gate-num">{g.name}</span>
                        {g.code && <span className="cart-gate-code">{g.code}</span>}
                      </div>
                      {g.is_entry_exit && <span className="cart-gate-badge"><span className="material-symbols-outlined">directions_car</span>Vehículos</span>}
                    </header>
                    {typeSummary('CARGA', g.carts_carga)}
                    {typeSummary('COMPRA', g.carts_compra)}
                  </article>
                );
              })}
            </div>
          </div>
        )}

        <CartCheckoutForm
          schemaName={schemaName}
          carts={carts}
          towers={towers}
          gates={activeGates}
          busy={checkoutBusy}
          onCheckout={handleCheckout}
        />

        <div className="cart-loans-table">
          <h4>Carritos prestados</h4>
          <table className="residents-table residents-desktop cart-scroll-table">
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
              ) : activeLoans.map(l => {
                const st = loanStatus(now, l, config);
                return (
                  <tr key={l.id} className={`loan-row loan-${st.severity}`}>
                    <td>{l.cart_code || '-'}{l.cart_gate?.name ? ` (${l.cart_gate.name})` : ''}</td>
                    <td>{l.tower_code || '-'}</td>
                    <td>{l.department_number || '-'}</td>
                    <td>{new Date(l.checkout_time).toLocaleString('es-PE')}</td>
                    <td><span className="loan-timer">{fmtDuration(st.elapsedSec)}</span></td>
                    <td>{st.remainingSec <= 0
                      ? <span className="loan-overdue-label">Vencido</span>
                      : <span className={st.severity === 'ok' ? 'text-muted' : ''}>en {fmtDuration(st.remainingSec)}</span>}
                    </td>
                    <td>
                      {st.fine > 0
                        ? <span className="fines-tag">{fmtMoney(st.fine)}</span>
                        : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <button className="btn-primary" onClick={() => handleCheckin(l)} disabled={checkinBusyId === l.id}>
                        {checkinBusyId === l.id ? '...' : 'Devolución'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}