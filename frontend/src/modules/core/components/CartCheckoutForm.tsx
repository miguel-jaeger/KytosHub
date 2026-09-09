import { useMemo, useState } from 'react';
import type { Cart, Department, Floor, Gate, Tower } from '../types';

interface Props {
  carts: Cart[];
  departments: Department[];
  towers: Tower[];
  floors: Floor[];
  gates: Gate[];
  busy: boolean;
  onCheckout: (cartId: string, departmentId: string) => Promise<void> | void;
}

const CART_TYPE_LABELS: Record<string, string> = { CARGA: 'Carro de carga', COMPRA: 'Coche de compras' };

export function CartCheckoutForm({ carts, departments, towers, floors, gates, busy, onCheckout }: Props) {
  const [towerId, setTowerId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [cartId, setCartId] = useState('');

  const availableCarts = useMemo(() => carts.filter(c => c.status === 'DISPONIBLE'), [carts]);
  const towerFloors = useMemo(() => floors.filter(f => f.tower_id === towerId).sort((a, b) => a.floor_number - b.floor_number), [floors, towerId]);
  const towerDepartments = useMemo(
    () => (towerId && floorId ? departments.filter(d => d.tower_id === towerId && d.floor_id === floorId) : []),
    [departments, towerId, floorId]
  );
  const selectedTower = towers.find(t => t.id === towerId);
  const selectedFloor = towerFloors.find(f => f.id === floorId);

  const selectTower = (id: string) => {
    setTowerId(id);
    setFloorId('');
    setDeptId('');
  };

  const selectFloor = (id: string) => {
    setFloorId(id);
    setDeptId('');
  };

  const handleSubmit = async () => {
    if (!cartId || !deptId) return;
    await onCheckout(cartId, deptId);
    setCartId('');
    setDeptId('');
  };

  return (
    <div className="cart-checkout-form">
      <h4>Registrar Préstamo</h4>
      <p className="cart-checkout-hint">Elige torre, piso y departamento del residente, y el carrito que llevará.</p>

      <div className="checkout-field">
        <label>1. Torre</label>
        {towers.length === 0 ? (
          <span className="text-muted">No hay torres registradas.</span>
        ) : (
          <div className="checkout-tower-chips">
            {towers.map(t => (
              <button
                key={t.id}
                type="button"
                className={`checkout-chip ${towerId === t.id ? 'active' : ''}`}
                onClick={() => selectTower(t.id)}
              >
                <span className="checkout-chip-code">{t.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="checkout-field">
        <label>2. Piso</label>
        {towerId === '' ? (
          <span className="text-muted">Primero elige la torre.</span>
        ) : towerFloors.length === 0 ? (
          <span className="text-muted">Esa torre no tiene pisos.</span>
        ) : (
          <select value={floorId} onChange={e => selectFloor(e.target.value)}>
            <option value="">Seleccionar piso...</option>
            {towerFloors.map(f => (
              <option key={f.id} value={f.id}>
                Piso {f.floor_number}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="checkout-field">
        <label>3. Departamento</label>
        {towerId === '' ? (
          <span className="text-muted">Primero elige la torre.</span>
        ) : floorId === '' ? (
          <span className="text-muted">Primero elige el piso.</span>
        ) : towerDepartments.length === 0 ? (
          <span className="text-muted">Ese piso no tiene departamentos.</span>
        ) : (
          <select value={deptId} onChange={e => setDeptId(e.target.value)}>
            <option value="">Seleccionar departamento...</option>
            {towerDepartments.map(d => (
              <option key={d.id} value={d.id}>
                Dpto {d.department_number} {d.status === 'HABITADO' ? '' : `(${d.status.toLowerCase()})`}
              </option>
            ))}
          </select>
        )}
        {selectedTower && selectedFloor && deptId && (
          <span className="checkout-hint-inline">
            Torre {selectedTower.code} · Piso {selectedFloor.floor_number} · Dpto {towerDepartments.find(d => d.id === deptId)?.department_number}
          </span>
        )}
      </div>

      <div className="checkout-field">
        <label>4. Carrito</label>
        {availableCarts.length === 0 ? (
          <span className="text-muted">No hay carritos disponibles.</span>
        ) : (
          <select value={cartId} onChange={e => setCartId(e.target.value)}>
            <option value="">Seleccionar carrito...</option>
            {availableCarts.map(c => (
              <option key={c.id} value={c.id}>
                {c.code_identifier}{c.gate?.name ? ` · ${c.gate.name}` : ''} · {CART_TYPE_LABELS[c.cart_type || 'CARGA']}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="form-actions">
        <button
          onClick={handleSubmit}
          disabled={busy || !cartId || !deptId}
          className="btn-primary checkout-submit"
        >
          {busy ? 'Prestado...' : 'Prestar'}
        </button>
      </div>
      {gates.length === 0 && <span className="text-muted checkout-hint-inline">Sin puertas configuradas: el carrito se prestará sin puerta asignada.</span>}
    </div>
  );
}