import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCartLending } from '../hooks/useCartLending';
import { useCondoGates } from '../hooks/useCondoGates';
import { CartCheckoutForm } from './CartCheckoutForm';
import type { Cart, CartLoan, CartLendingConfig, FinesSummaryRow, Gate, Tower } from '../types';

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

export function CartLendingManager({ schemaName }: { schemaName?: string }) {
  const { listCarts, createCart, updateCart, deleteCart, listLoans, checkout, checkin, finesSummary } = useCartLending();
  const { list: listGates } = useCondoGates();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loans, setLoans] = useState<CartLoan[]>([]);
  const [config, setConfig] = useState<CartLendingConfig | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [towers, setTowers] = useState<Tower[]>([]);
  const [fines, setFines] = useState<FinesSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'estado' | 'carts' | 'fines'>('estado');

  const [cartForm, setCartForm] = useState({ code_identifier: '', status: 'DISPONIBLE', gate_id: '', cart_type: 'CARGA', notes: '' });
  const [editingCart, setEditingCart] = useState<Cart | null>(null);
  const [savingCart, setSavingCart] = useState(false);

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
    const lr = await listLoans(schemaName);
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
        await loadCarts();
        await loadLoans();
        setGates(await listGates(schemaName));
        // Towers for the checkout selector (torre para el préstamo)
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

  const openFines = async () => {
    if (!schemaName) return;
    setError(null);
    try { setFines(await finesSummary(schemaName)); } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
  };

  const handleAddOrUpdateCart = async () => {
    if (!schemaName) return;
    if (!cartForm.code_identifier.trim()) { alert('El código del carrito es obligatorio'); return; }
    setSavingCart(true);
    setError(null);
    try {
      const gateId = cartForm.gate_id.trim() === '' ? null : cartForm.gate_id.trim();
      if (editingCart) {
        await updateCart(schemaName, editingCart.id, { code_identifier: cartForm.code_identifier, status: cartForm.status as Cart['status'], cart_type: cartForm.cart_type, gate_id: gateId ?? undefined, notes: cartForm.notes });
      } else {
        await createCart(schemaName, { code_identifier: cartForm.code_identifier, status: cartForm.status, cart_type: cartForm.cart_type, gate_id: gateId ?? undefined, notes: cartForm.notes });
      }
      setCartForm({ code_identifier: '', status: 'DISPONIBLE', gate_id: '', cart_type: 'CARGA', notes: '' });
      setEditingCart(null);
      setMessage('Carrito guardado');
      setCarts(await listCarts(schemaName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSavingCart(false);
    }
  };

  const startEditCart = (c: Cart) => {
    setEditingCart(c);
    setCartForm({ code_identifier: c.code_identifier, status: c.status, gate_id: c.gate_id || c.gate?.id || '', cart_type: c.cart_type || 'CARGA', notes: c.notes || '' });
    setTab('carts');
  };

  const handleDeleteCart = async (c: Cart) => {
    if (!schemaName) return;
    if (!confirm(`¿Eliminar el carrito "${c.code_identifier}"?`)) return;
    try {
      await deleteCart(schemaName, c.id);
      setMessage('Carrito eliminado');
      setCarts(await listCarts(schemaName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleCheckout = async (cartId: string, departmentId: string) => {
    if (!schemaName) return;
    setCheckoutBusy(true);
    setError(null);
    try {
      const loan = await checkout(schemaName, cartId, departmentId);
      setMessage(`Préstamo registrado${loan && loan.due_time ? ` hasta ${new Date(loan.due_time).toLocaleString('es-PE')}` : ''}`);
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

  if (loading) return <div className="loading-message">Cargando módulo de carritos...</div>;

  const activeLoans = loans.filter(l => l.status === 'ACTIVO');
  const prestados = carts.filter(c => c.status === 'PRESTADO').length;
  const mantenimiento = carts.filter(c => c.status === 'MANTENIMIENTO').length;
  const disponibles = carts.filter(c => c.status === 'DISPONIBLE').length;
  const activeGates = gates.filter(g => g.is_active);

  return (
    <div className="cart-lending-manager">
      <div className="modules-header">
        <h3>Préstamo de Carritos y Multas</h3>
        {config && (
          <small>
            Préstamo máx: {config.max_loan_minutes} min · Gracia: {config.grace_period_minutes} min · Multa: {fmtMoney(config.fine_amount)} cada {config.fine_interval_minutes} min · Puertas: {gates.length}
            {config.fine_enabled ? '' : ' (multas desactivadas)'}
          </small>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="setup-tabs">
        <button className={tab === 'estado' ? 'active' : ''} onClick={() => setTab('estado')}>Estado actual</button>
        <button className={tab === 'carts' ? 'active' : ''} onClick={() => setTab('carts')}>Carritos</button>
        <button className={tab === 'fines' ? 'active' : ''} onClick={() => { setTab('fines'); void openFines(); }}>Multas por departamento</button>
      </div>

      {tab === 'estado' && (
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
                    return (
                      <span className="cart-gate-type">
                        <span className="cart-gate-type-label">{type === 'CARGA' ? 'Carga' : 'Compras'}</span>
                        <span className="cart-gate-type-counts">
                          <span className="cart-gate-disp">{disp} disp.</span>
                          <span className={prest > 0 ? 'cart-gate-prestado' : ''}>{prest} prest.</span>
                        </span>
                        <span className="cart-gate-cap">cap {capacity}</span>
                      </span>
                    );
                  };
                  return (
                    <div key={g.id} className="cart-gate-card">
                      <span className="cart-gate-num">{g.name}</span>
                      {typeSummary('CARGA', g.carts_carga)}
                      {typeSummary('COMPRA', g.carts_compra)}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <CartCheckoutForm
            schemaName={schemaName}
            carts={carts}
            towers={towers}
            gates={gates.filter(g => g.is_active)}
            busy={checkoutBusy}
            onCheckout={handleCheckout}
          />

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
      )}

      {tab === 'carts' && (
        <div className="cart-crud">
          <div className="cart-form">
            <h4>{editingCart ? 'Editar Carrito' : 'Registrar Carrito'}</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Código</label>
                <input type="text" value={cartForm.code_identifier} onChange={e => setCartForm({ ...cartForm, code_identifier: e.target.value })} placeholder="Ej: CART-01" />
              </div>
              <div className="form-group">
                <label>Puerta</label>
                <select value={cartForm.gate_id} onChange={e => setCartForm({ ...cartForm, gate_id: e.target.value })}>
                  <option value="">Sin puerta</option>
                  {activeGates.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Tipo</label>
                <select value={cartForm.cart_type} onChange={e => setCartForm({ ...cartForm, cart_type: e.target.value })}>
                  <option value="CARGA">Carro de carga</option>
                  <option value="COMPRA">Coche de compras</option>
                </select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={cartForm.status} onChange={e => setCartForm({ ...cartForm, status: e.target.value })}>
                  <option value="DISPONIBLE">Disponible</option>
                  <option value="PRESTADO">Prestado</option>
                  <option value="MANTENIMIENTO">Mantenimiento</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Notas</label>
              <input type="text" value={cartForm.notes} onChange={e => setCartForm({ ...cartForm, notes: e.target.value })} placeholder="Observaciones" />
            </div>
            <div className="form-actions">
              {editingCart && <button className="btn-cancel" onClick={() => { setEditingCart(null); setCartForm({ code_identifier: '', status: 'DISPONIBLE', gate_id: '', cart_type: 'CARGA', notes: '' }); }}>Cancelar</button>}
              <button onClick={handleAddOrUpdateCart} disabled={savingCart}>{savingCart ? 'Guardando...' : editingCart ? 'Guardar' : 'Registrar'}</button>
            </div>
          </div>

          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Código</th>
                <th>Puerta</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carts.length === 0 ? (
                <tr><td colSpan={6} className="empty-text">No hay carritos registrados.</td></tr>
              ) : carts.map(c => (
                <tr key={c.id}>
                  <td>{c.code_identifier}</td>
                  <td>{c.gate?.name || '-'}</td>
                  <td>{CART_TYPE_LABELS[c.cart_type || 'CARGA']}</td>
                  <td><span className={`status-badge status-cart-${(c.status || '').toLowerCase()}`}>{c.status}</span></td>
                  <td>{c.notes || '-'}</td>
                  <td>
                    <div className="resident-row-actions">
                      <button className="btn-edit" onClick={() => startEditCart(c)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                      <button className="btn-danger" onClick={() => handleDeleteCart(c)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'fines' && (
        <div className="cart-fines">
          <div className="modules-header">
            <h4>Multas por concepto de carritos (por departamento)</h4>
            <small>Montos pendientes y cobrados por demora en la devolución de carritos.</small>
          </div>
          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Departamento</th>
                <th>Torre</th>
                <th>Veces</th>
                <th>Pendiente</th>
                <th>Cobrado</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {fines.length === 0 ? (
                <tr><td colSpan={6} className="empty-text">No hay multas registradas por este concepto.</td></tr>
              ) : fines.map(f => (
                <tr key={f.department_id}>
                  <td>{f.department_number || '-'}</td>
                  <td>{f.tower_code || '-'}</td>
                  <td>{f.count}</td>
                  <td>{f.pending > 0 ? fmtMoney(f.pending) : '-'}</td>
                  <td>{f.cobrada > 0 ? fmtMoney(f.cobrada) : '-'}</td>
                  <td className="fines-total">{fmtMoney(f.total_fine)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}