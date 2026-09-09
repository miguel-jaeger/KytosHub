import { useState } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { Cart, Department, Floor, Gate, Tower } from '../types';

interface Props {
  schemaName?: string;
  carts: Cart[];
  towers: Tower[];
  gates: Gate[];
  busy: boolean;
  onCheckout: (cartId: string, departmentId: string) => Promise<void> | void;
}

const CART_TYPE_LABELS: Record<string, string> = { CARGA: 'Carro de carga', COMPRA: 'Coche de compras' };

export function CartCheckoutForm({ schemaName, carts, towers, gates, busy, onCheckout }: Props) {
  const [towerId, setTowerId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [gateId, setGateId] = useState('');
  const [cartType, setCartType] = useState('');
  const [cartId, setCartId] = useState('');

  const [floors, setFloors] = useState<Floor[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadingStep, setLoadingStep] = useState<string | null>(null);

  const loadFloors = async (tid: string) => {
    setLoadingStep('pisos');
    setFloors([]);
    setDepartments([]);
    setFloorId('');
    setDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: tid }
      });
      setFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } finally {
      setLoadingStep(null);
    }
  };

  const loadDepartments = async (fid: string) => {
    setLoadingStep('departamentos');
    setDepartments([]);
    setDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: towerId, floor_id: fid }
      });
      setDepartments(data?.data || []);
    } finally {
      setLoadingStep(null);
    }
  };

  const availableCarts = carts.filter(c => c.status === 'DISPONIBLE');
  const gateAvailable = (gid: string) => availableCarts.filter(c => c.gate_id === gid).length;
  const typeCount = (type: string) => availableCarts.filter(c => c.gate_id === gateId && c.cart_type === type).length;
  const gateCarts = availableCarts.filter(c => c.gate_id === gateId && c.cart_type === cartType);

  const selectedTower = towers.find(t => t.id === towerId);
  const selectedFloor = floors.find(f => f.id === floorId);
  const selectedDepartment = departments.find(d => d.id === deptId);
  const selectedGate = gates.find(g => g.id === gateId);

  const resetAfterDept = () => { setGateId(''); setCartType(''); setCartId(''); };

  const selectTower = (id: string) => {
    setTowerId(id);
    setFloorId('');
    setDeptId('');
    resetAfterDept();
    void loadFloors(id);
  };

  const selectFloor = (id: string) => {
    setFloorId(id);
    setDeptId('');
    resetAfterDept();
    void loadDepartments(id);
  };

  const selectDepartment = (id: string) => {
    setDeptId(id);
    resetAfterDept();
  };

  const selectGate = (id: string) => {
    setGateId(id);
    setCartType('');
    setCartId('');
  };

  const selectType = (type: string) => {
    setCartType(type);
    setCartId('');
  };

  const handleSubmit = async () => {
    if (!cartId || !deptId) return;
    await onCheckout(cartId, deptId);
    setCartId('');
  };

  return (
    <div className="cart-checkout-form">
      <h4>Registrar Préstamo</h4>
      <p className="cart-checkout-hint">Sigue los pasos: torre, piso, departamento, puerta, tipo de carrito y el carrito a prestar.</p>

      <div className="checkout-field">
        <label>1. Torre</label>
        {towers.length === 0 ? (
          <span className="text-muted">No hay torres registradas.</span>
        ) : (
          <div className="checkout-chip-row">
            {towers.map(t => (
              <button key={t.id} type="button" className={`checkout-chip ${towerId === t.id ? 'active' : ''}`} onClick={() => selectTower(t.id)}>
                <span className="checkout-chip-code">{t.code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {towerId !== '' && (
        <div className="checkout-field">
          <label>2. Piso</label>
          {loadingStep === 'pisos' ? (
            <span className="text-muted">Cargando pisos...</span>
          ) : floors.length === 0 ? (
            <span className="text-muted">Esa torre no tiene pisos.</span>
          ) : (
            <div className="checkout-chip-grid">
              {floors.map(f => (
                <button key={f.id} type="button" className={`checkout-chip ${floorId === f.id ? 'active' : ''}`} onClick={() => selectFloor(f.id)}>
                  {f.floor_number}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {towerId !== '' && floorId !== '' && (
        <div className="checkout-field">
          <label>3. Departamento</label>
          {loadingStep === 'departamentos' ? (
            <span className="text-muted">Cargando departamentos...</span>
          ) : departments.length === 0 ? (
            <span className="text-muted">Ese piso no tiene departamentos.</span>
          ) : (
            <div className="checkout-chip-grid">
              {departments.map(d => (
                <button
                  key={d.id}
                  type="button"
                  className={`checkout-chip checkout-chip-wide ${deptId === d.id ? 'active' : ''}`}
                  onClick={() => selectDepartment(d.id)}
                >
                  {d.department_number}
                </button>
              ))}
            </div>
          )}
          {selectedTower && selectedFloor && deptId && (
            <span className="checkout-hint-inline">
              Torre {selectedTower.code} · Piso {selectedFloor.floor_number} · Dpto {selectedDepartment?.department_number}
            </span>
          )}
        </div>
      )}

      {towerId !== '' && floorId !== '' && deptId !== '' && (
        <div className="checkout-field">
          <label>4. Puerta</label>
          {gates.length === 0 ? (
            <span className="text-muted">Sin puertas configuradas.</span>
          ) : (
            <div className="checkout-chip-grid">
              {gates.map(g => {
                const disp = gateAvailable(g.id);
                const disabled = disp === 0;
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`checkout-chip checkout-chip-wide ${gateId === g.id ? 'active' : ''} ${disabled ? 'checkout-chip-disabled' : ''}`}
                    disabled={disabled}
                    onClick={() => selectGate(g.id)}
                  >
                    <span className="checkout-chip-code">{g.name}</span>
                    <small className={disp > 0 ? 'checkout-chip-count' : 'checkout-chip-count-empty'}>
                      {disp > 0 ? `${disp} disponible${disp === 1 ? '' : 's'}` : 'Sin disponibilidad'}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {towerId !== '' && floorId !== '' && deptId !== '' && gateId !== '' && (
        <div className="checkout-field">
          <label>5. Tipo de carrito</label>
          <div className="checkout-chip-row">
            {Object.entries(CART_TYPE_LABELS).map(([type, label]) => {
              const count = typeCount(type);
              const disabled = count === 0;
              return (
                <button
                  key={type}
                  type="button"
                  className={`checkout-chip checkout-chip-wide ${cartType === type ? 'active' : ''} ${disabled ? 'checkout-chip-disabled' : ''}`}
                  disabled={disabled}
                  onClick={() => selectType(type)}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
        </div>
      )}

      {towerId !== '' && floorId !== '' && deptId !== '' && gateId !== '' && cartType !== '' && (
        <div className="checkout-field">
          <label>6. Carrito a prestar</label>
          {gateCarts.length === 0 ? (
            <span className="text-muted">No hay carritos disponibles de {CART_TYPE_LABELS[cartType]} en {selectedGate?.name}.</span>
          ) : (
            <div className="checkout-chip-grid">
              {gateCarts.map(c => (
                <button
                  key={c.id}
                  type="button"
                  className={`checkout-chip ${cartId === c.id ? 'active' : ''}`}
                  onClick={() => setCartId(c.id)}
                >
                  <span className="checkout-chip-code">{c.code_identifier}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="form-actions">
        <button onClick={handleSubmit} disabled={busy || !cartId || !deptId} className="btn-primary checkout-submit">
          {busy ? 'Prestado...' : 'Prestar'}
        </button>
      </div>
    </div>
  );
}