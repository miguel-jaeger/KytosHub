import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCartLending } from '../hooks/useCartLending';
import type { Cart, CartLoan, CartLendingConfig, Department, Tower } from '../types';

interface DeptOption {
  id: string;
  label: string;
}

export function CartLendingManager({ schemaName }: { schemaName?: string }) {
  const { listCarts, createCart, updateCart, deleteCart, listLoans, checkout, checkin } = useCartLending();
  const [carts, setCarts] = useState<Cart[]>([]);
  const [loans, setLoans] = useState<CartLoan[]>([]);
  const [config, setConfig] = useState<CartLendingConfig | null>(null);
  const [deptOptions, setDeptOptions] = useState<DeptOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'carts' | 'loans'>('carts');

  const [cartForm, setCartForm] = useState({ code_identifier: '', status: 'DISPONIBLE', notes: '' });
  const [editingCart, setEditingCart] = useState<Cart | null>(null);
  const [savingCart, setSavingCart] = useState(false);

  const [checkoutCartId, setCheckoutCartId] = useState('');
  const [checkoutDeptId, setCheckoutDeptId] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkinBusyId, setCheckinBusyId] = useState<string | null>(null);

  const load = useCallback(async (withLoans: boolean) => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const c = await listCarts(schemaName);
      setCarts(c);
      if (withLoans) {
        const lr = await listLoans(schemaName);
        setLoans(lr.loans);
        setConfig(lr.config);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de carga');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listCarts, listLoans]);

  useEffect(() => {
    void load(true);
    if (!schemaName) return;
    let cancelled = false;
    (async () => {
      try {
const deptRes = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
      const towerRes = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
      if (cancelled) return;
      const deptData: Department[] = deptRes?.data?.data || [];
      const towerData: Tower[] = towerRes?.data?.data || [];
      const towerCode = new Map(towerData.map(t => [t.id, t.code]));
      setDeptOptions(deptData.map(d => ({
        id: d.id,
        label: `Dpto ${d.department_number}${towerCode.get(d.tower_id) ? ` (${towerCode.get(d.tower_id)})` : ''}`
      })));
      } catch { /* departments optional */ }
    })();
    return () => { cancelled = true; };
  }, [schemaName]);

  const refreshLoans = async () => {
    if (!schemaName) return;
    const lr = await listLoans(schemaName);
    setLoans(lr.loans);
    setConfig(lr.config);
  };

  const handleAddOrUpdateCart = async () => {
    if (!schemaName) return;
    if (!cartForm.code_identifier.trim()) { alert('El código del carrito es obligatorio'); return; }
    setSavingCart(true);
    setError(null);
    try {
      if (editingCart) {
        await updateCart(schemaName, editingCart.id, { code_identifier: cartForm.code_identifier, status: cartForm.status as Cart['status'], notes: cartForm.notes });
      } else {
        await createCart(schemaName, { code_identifier: cartForm.code_identifier, status: cartForm.status, notes: cartForm.notes });
      }
      setCartForm({ code_identifier: '', status: 'DISPONIBLE', notes: '' });
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
    setCartForm({ code_identifier: c.code_identifier, status: c.status, notes: c.notes || '' });
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

  const handleCheckout = async () => {
    if (!schemaName) return;
    if (!checkoutCartId || !checkoutDeptId) { alert('Seleccione carrito y departamento'); return; }
    setCheckoutBusy(true);
    setError(null);
    try {
      const loan = await checkout(schemaName, checkoutCartId, checkoutDeptId);
      setMessage(`Préstamo registrado hasta ${loan ? new Date(loan.due_time).toLocaleString('es-PE') : ''}`);
      setCheckoutCartId('');
      setCheckoutDeptId('');
      setCarts(await listCarts(schemaName));
      await refreshLoans();
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
        alert(`Carrito devuelto con retraso. Multa generada: S/ ${result.penalty_amount}`);
      }
      setCarts(await listCarts(schemaName));
      await refreshLoans();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setCheckinBusyId(null);
    }
  };

  if (loading) return <div className="loading-message">Cargando módulo de carritos...</div>;

  const availableCarts = carts.filter(c => c.status === 'DISPONIBLE');

  return (
    <div className="cart-lending-manager">
      <div className="modules-header">
        <h3>Préstamo de Carritos y Multas</h3>
        {config && (
          <small>
            Préstamo máx: {config.max_loan_minutes} min · Gracia: {config.grace_period_minutes} min · Multa: S/ {config.fine_amount} cada {config.fine_interval_minutes} min {config.fine_enabled ? '' : '(multas desactivadas)'}
          </small>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      <div className="setup-tabs">
        <button className={tab === 'carts' ? 'active' : ''} onClick={() => setTab('carts')}>Carritos</button>
        <button className={tab === 'loans' ? 'active' : ''} onClick={() => setTab('loans')}>Préstamos ({loans.filter(l => l.status === 'ACTIVO').length} activos)</button>
      </div>

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
              {editingCart && <button className="btn-cancel" onClick={() => { setEditingCart(null); setCartForm({ code_identifier: '', status: 'DISPONIBLE', notes: '' }); }}>Cancelar</button>}
              <button onClick={handleAddOrUpdateCart} disabled={savingCart}>{savingCart ? 'Guardando...' : editingCart ? 'Guardar' : 'Registrar'}</button>
            </div>
          </div>

          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Código</th>
                <th>Estado</th>
                <th>Notas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carts.length === 0 ? (
                <tr><td colSpan={4} className="empty-text">No hay carritos registrados.</td></tr>
              ) : carts.map(c => (
                <tr key={c.id}>
                  <td>{c.code_identifier}</td>
                  <td><span className={`status-badge ${c.status === 'DISPONIBLE' ? 'status-occupied' : 'status-vacant'}`}>{c.status}</span></td>
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

      {tab === 'loans' && (
        <div className="cart-loans">
          <div className="cart-checkout-form">
            <h4>Registrar Préstamo</h4>
            <div className="form-row">
              <div className="form-group">
                <label>Carrito</label>
                <select value={checkoutCartId} onChange={e => setCheckoutCartId(e.target.value)}>
                  <option value="">Seleccionar...</option>
                  {availableCarts.map(c => <option key={c.id} value={c.id}>{c.code_identifier}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Departamento</label>
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

          <table className="residents-table residents-desktop">
            <thead>
              <tr>
                <th>Carrito</th>
                <th>Departamento</th>
                <th>Prestado</th>
                <th>Vence</th>
                <th>Estado</th>
                <th>Multa</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 ? (
                <tr><td colSpan={7} className="empty-text">No hay préstamos registrados.</td></tr>
              ) : loans.map(l => (
                <tr key={l.id}>
                  <td>{l.cart_code || '-'}</td>
                  <td>{l.tower_code ? `${l.department_number} (${l.tower_code})` : (l.department_number || '-')}</td>
                  <td>{new Date(l.checkout_time).toLocaleString('es-PE')}</td>
                  <td>{new Date(l.due_time).toLocaleString('es-PE')}</td>
                  <td><span className={`status-badge ${l.status === 'ACTIVO' ? 'status-occupied' : 'status-vacant'}`}>{l.status}</span></td>
                  <td>{l.penalty_amount > 0 ? `S/ ${l.penalty_amount}` : '-'}</td>
                  <td>
                    {l.status === 'ACTIVO' && (
                      <button className="btn-primary" onClick={() => handleCheckin(l)} disabled={checkinBusyId === l.id}>
                        {checkinBusyId === l.id ? '...' : 'Devolución'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}