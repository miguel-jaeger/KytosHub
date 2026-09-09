import { useState, useEffect, useCallback } from 'react';
import { useCartLending } from '../hooks/useCartLending';
import { useCondoGates } from '../hooks/useCondoGates';
import type { Cart, CartLoan, CartLendingConfig, FinesSummaryRow, Gate } from '../types';

function fmtMoney(n: number): string {
  return `S/ ${(Number(n) || 0).toFixed(2)}`;
}

const CART_TYPE_LABELS: Record<string, string> = { CARGA: 'Carro de carga', COMPRA: 'Coche de compras' };

const LOAN_STATUS_LABELS: Record<string, string> = {
  ACTIVO: 'En curso',
  DEVUELTO: 'Devuelto',
  ATRASADO: 'Atrasado'
};

const LOAN_STATUS_CLASS: Record<string, string> = {
  ACTIVO: 'status-warn',
  DEVUELTO: 'status-occupied',
  ATRASADO: 'status-late'
};

const PENALTY_LABELS: Record<string, string> = {
  NINGUNA: 'Sin multa',
  PENDIENTE: 'Pendiente de cobro',
  COBRADA: 'Cobrada',
  EXONERADA: 'Exonerada'
};

export function CartLendingManager({ schemaName }: { schemaName?: string }) {
  const { listCarts, createCart, updateCart, deleteCart, listLoans, finesSummary } = useCartLending();
  const { list: listGates } = useCondoGates();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loans, setLoans] = useState<CartLoan[]>([]);
  const [config, setConfig] = useState<CartLendingConfig | null>(null);
  const [gates, setGates] = useState<Gate[]>([]);
  const [fines, setFines] = useState<FinesSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'carts' | 'stats'>('carts');

  const [cartForm, setCartForm] = useState({ code_identifier: '', status: 'DISPONIBLE', gate_id: '', cart_type: 'CARGA', notes: '' });
  const [editingCart, setEditingCart] = useState<Cart | null>(null);
  const [savingCart, setSavingCart] = useState(false);

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
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [schemaName, loadCarts, loadLoans, listGates]);

  const openStats = async () => {
    if (!schemaName) return;
    setError(null);
    try {
      await loadLoans();
      setFines(await finesSummary(schemaName));
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); }
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

  if (loading) return <div className="loading-message">Cargando módulo de carritos...</div>;

  const activeGates = gates.filter(g => g.is_active);
  const prestados = carts.filter(c => c.status === 'PRESTADO').length;
  const mantenimiento = carts.filter(c => c.status === 'MANTENIMIENTO').length;
  const disponibles = carts.filter(c => c.status === 'DISPONIBLE').length;

  const activos = loans.filter(l => l.status === 'ACTIVO').length;
  const devueltos = loans.filter(l => l.status === 'DEVUELTO').length;
  const atrasados = loans.filter(l => l.status === 'ATRASADO').length;
  const multasPendientes = loans
    .filter(l => l.penalty_status === 'PENDIENTE')
    .reduce((a, l) => a + (Number(l.penalty_amount) || 0), 0);
  const multasCobradas = loans
    .filter(l => l.penalty_status === 'COBRADA')
    .reduce((a, l) => a + (Number(l.penalty_amount) || 0), 0);
  const multasEstimadas = loans
    .filter(l => l.status === 'ACTIVO' && (l.estimated_fine || 0) > 0)
    .reduce((a, l) => a + (Number(l.estimated_fine) || 0), 0);

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
        <button className={tab === 'carts' ? 'active' : ''} onClick={() => setTab('carts')}>Carritos</button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => { setTab('stats'); void openStats(); }}>Estadísticas y multas</button>
      </div>

      {tab === 'carts' && (
        <div className="cart-crud">
          <div className="modules-header">
            <h4>Configuración de carritos</h4>
            <small>Registra o edita los carritos físicos, su código, puerta de origen, tipo y estado. Los préstamos y devoluciones se realizan desde el Panel de Garita.</small>
          </div>

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

      {tab === 'stats' && (
        <div className="cart-estado">
          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">shopping_cart</span><strong>{carts.length}</strong> carritos</div>
            <div className="cart-kpi cart-kpi-dispo"><span className="material-symbols-outlined">check_circle</span><strong>{disponibles}</strong> disponibles</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">swap_horiz</span><strong>{prestados}</strong> prestados</div>
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">build</span><strong>{mantenimiento}</strong> en mantenimiento</div>
          </div>

          <div className="cart-kpi-row">
            <div className="cart-kpi"><span className="material-symbols-outlined">history</span><strong>{loans.length}</strong> préstamos</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">swap_horiz</span><strong>{activos}</strong> en curso</div>
            <div className="cart-kpi"><span className="material-symbols-outlined">task_alt</span><strong>{devueltos}</strong> devueltos</div>
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">warning</span><strong>{atrasados}</strong> atrasados</div>
          </div>

          <div className="cart-kpi-row">
            <div className="cart-kpi cart-kpi-mant"><span className="material-symbols-outlined">account_balance_wallet</span><strong>{fmtMoney(multasPendientes)}</strong> multas pendientes</div>
            <div className="cart-kpi cart-kpi-prestado"><span className="material-symbols-outlined">schedule</span><strong>{fmtMoney(multasEstimadas)}</strong> multas estimadas en curso</div>
            <div className="cart-kpi cart-kpi-dispo"><span className="material-symbols-outlined">payments</span><strong>{fmtMoney(multasCobradas)}</strong> multas cobradas</div>
          </div>

          <div className="cart-loans-table">
            <h4>Historial de préstamos</h4>
            <table className="residents-table residents-desktop">
              <thead>
                <tr>
                  <th>Carrito</th>
                  <th>Puerta</th>
                  <th>Torre</th>
                  <th>Depto</th>
                  <th>Desde</th>
                  <th>Devolución</th>
                  <th>Estado</th>
                  <th>Multa</th>
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr><td colSpan={8} className="empty-text">Aún no hay préstamos registrados.</td></tr>
                ) : loans.map(l => (
                  <tr key={l.id}>
                    <td>{l.cart_code || '-'}</td>
                    <td>{l.cart_gate?.name || '-'}</td>
                    <td>{l.tower_code || '-'}</td>
                    <td>{l.department_number || '-'}</td>
                    <td>{new Date(l.checkout_time).toLocaleString('es-PE')}</td>
                    <td>{l.checkin_time ? new Date(l.checkin_time).toLocaleString('es-PE') : '—'}</td>
                    <td><span className={`status-badge ${LOAN_STATUS_CLASS[l.status] || 'status-vacant'}`}>{LOAN_STATUS_LABELS[l.status] || l.status}</span></td>
                    <td>
                      {l.status === 'ACTIVO'
                        ? ((l.estimated_fine || 0) > 0
                          ? <span className="fines-tag">{fmtMoney(l.estimated_fine!)}</span>
                          : <span className="text-muted">—</span>)
                        : ((Number(l.penalty_amount) || 0) > 0
                          ? <div>
                              <span className="fines-tag">{fmtMoney(l.penalty_amount)}</span>{' '}
                              <small className="text-muted">{PENALTY_LABELS[l.penalty_status] || l.penalty_status}</small>
                            </div>
                          : <span className="text-muted">—</span>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cart-fines">
            <div className="modules-header">
              <h4>Multas por departamento</h4>
              <small>Montos pendientes y cobrados por demora en la devolución de carritos, para determinar las multas a aplicar.</small>
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
        </div>
      )}
    </div>
  );
}