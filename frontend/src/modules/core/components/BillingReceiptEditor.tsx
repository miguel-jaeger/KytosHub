import { useState } from 'react';
import { BillingReceipt } from './BillingReceipt';
import type { BillingInvoice, MaintenanceReceipt, MaintenanceReceiptItem } from '../types';

function emptyItem(): MaintenanceReceiptItem {
  return { categoria: '', descripcion: '', cantidad: null, monto_total_gasto: null, importe_departamento: 0 };
}

export function BillingReceiptEditor({
  invoice,
  initial,
  onSave,
  onClose
}: {
  invoice: BillingInvoice;
  initial: MaintenanceReceipt | null;
  onSave: (data: MaintenanceReceipt) => Promise<void>;
  onClose: () => void;
}) {
  const base = initial || buildDefault(invoice);
  const [data, setData] = useState<MaintenanceReceipt>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const set = (patch: Partial<MaintenanceReceipt>) => setData(prev => ({ ...prev, ...patch }));

  const updateItem = (idx: number, patch: Partial<MaintenanceReceiptItem>) => {
    setData(prev => {
      const items = prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      const subtotal = items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
      return { ...prev, items, subtotal, total_mes: subtotal };
    });
  };

  const addItem = () => setData(prev => ({ ...prev, items: [...prev.items, emptyItem()] }));
  const removeItem = (idx: number) => {
    setData(prev => {
      const items = prev.items.filter((_, i) => i !== idx);
      const subtotal = items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
      return { ...prev, items, subtotal, total_mes: subtotal };
    });
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setData(prev => {
      const items = [...prev.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return prev;
      [items[idx], items[j]] = [items[j], items[idx]];
      return { ...prev, items };
    });
  };

  const resetSubtotals = () => {
    setData(prev => {
      const subtotal = prev.items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
      return { ...prev, subtotal, total_mes: subtotal };
    });
  };

  const entidades = [
    'BCP', 'SCOTIABANK', 'BBVA', 'INTERBANK', 'KASNET'
  ];

  const handleSave = async () => {
    if (!data.condominio.trim() || !data.titular.trim()) {
      setError('Completa el condominio y el titular del departamento.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el recibo');
    } finally {
      setSaving(false);
    }
  };

  const codigoManual = `CLM${data.edificio}${data.departamento.padStart(3, '0')}`;

  return (
    <div className="receipt-editor">
      <div className="setup-tabs" style={{ marginBottom: '1rem' }}>
        <button className="active">Datos del recibo</button>
        <button onClick={() => setShowPreview(v => !v)}>
          <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>{showPreview ? 'visibility_off' : 'visibility'}</span>
          {showPreview ? 'Ocultar vista previa' : 'Ver vista previa'}
        </button>
        <button onClick={() => window.print()}>Imprimir / Guardar PDF</button>
      </div>

      {showPreview && (
        <div className="receipt-editor-preview" style={{ marginBottom: '0.75rem' }}>
          <BillingReceipt data={data} />
        </div>
      )}

      <div className="receipt-editor-form">
        <div className="form-row">
            <div className="form-group">
              <label>N.º de recibo</label>
              <input type="text" value={data.numero_recibo} onChange={e => set({ numero_recibo: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Período</label>
              <input type="text" value={data.periodo} onChange={e => set({ periodo: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Fecha de emisión</label>
              <input type="date" value={data.fecha_emision} onChange={e => set({ fecha_emision: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Fecha de vencimiento</label>
              <input type="date" value={data.fecha_vencimiento} onChange={e => set({ fecha_vencimiento: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Deuda acumulada (S/)</label>
              <input type="number" min={0} value={String(data.deuda_total_acumulada)} onChange={e => set({ deuda_total_acumulada: Number(e.target.value) || 0 })} />
            </div>
          </div>
          <div className="form-group">
            <label>Condominio (emisor)</label>
            <input type="text" value={data.condominio} onChange={e => set({ condominio: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Titular</label>
              <input type="text" value={data.titular} onChange={e => set({ titular: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Edificio (torre)</label>
              <input type="text" value={data.edificio} onChange={e => set({ edificio: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Departamento</label>
              <input type="text" value={data.departamento} onChange={e => set({ departamento: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Código de recaudación</label>
              <input type="text" value={data.codigo_recaudacion} onChange={e => set({ codigo_recaudacion: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Plataforma de recaudación</label>
              <input type="text" value={data.plataforma_recaudacion} onChange={e => set({ plataforma_recaudacion: e.target.value })} />
            </div>
          </div>

          <div className="module-example">
            <span className="material-symbols-outlined">info</span>
            <span>
              Código generado por la estructura torre+departamento: <strong>{codigoManual}</strong>. Puedes ajustarlo manualmente si la torre o el departamento difieren.
            </span>
          </div>

          <div className="receipt-editor-section-title">Conceptos del mes (por categoría)</div>
          {data.items.map((it, idx) => (
            <div key={idx} className="receipt-item-row">
              <div className="form-group" style={{ flex: 1.2 }}>
                <input type="text" placeholder="Categoría (ej: SEDAPAL)" value={it.categoria} onChange={e => updateItem(idx, { categoria: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 2.2 }}>
                <input type="text" placeholder="Descripción" value={it.descripcion} onChange={e => updateItem(idx, { descripcion: e.target.value })} />
              </div>
              <div className="form-group" style={{ flex: 0.7 }}>
                <input type="text" placeholder="Cantidad" value={it.cantidad || ''} onChange={e => updateItem(idx, { cantidad: e.target.value || null })} />
              </div>
              <div className="form-group" style={{ flex: 0.7 }}>
                <input type="number" placeholder="Total gasto" value={it.monto_total_gasto === null ? '' : String(it.monto_total_gasto)} onChange={e => updateItem(idx, { monto_total_gasto: e.target.value === '' ? null : Number(e.target.value) })} />
              </div>
              <div className="form-group" style={{ flex: 0.7 }}>
                <input type="number" placeholder="Importe dpto" value={String(it.importe_departamento)} onChange={e => updateItem(idx, { importe_departamento: Number(e.target.value) || 0 })} />
              </div>
              <button type="button" className="icon-btn" title="Subir" onClick={() => moveItem(idx, -1)} disabled={idx === 0}><span className="material-symbols-outlined">arrow_upward</span></button>
              <button type="button" className="icon-btn" title="Bajar" onClick={() => moveItem(idx, 1)} disabled={idx === data.items.length - 1}><span className="material-symbols-outlined">arrow_downward</span></button>
              <button type="button" className="icon-btn danger" title="Eliminar" onClick={() => removeItem(idx)}><span className="material-symbols-outlined">close</span></button>
            </div>
          ))}
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={addItem}><span className="material-symbols-outlined">add</span> Agregar concepto</button>
            <button type="button" className="btn-cancel" onClick={resetSubtotals}><span className="material-symbols-outlined">calculate</span> Recalcular subtotales</button>
          </div>

          <div className="receipt-editor-section-title">Lectura del medidor de agua (opcional)</div>
          {data.marcas_agua.map((m, idx) => (
            <div key={idx} className="form-row">
              <div className="form-group">
                <input type="text" placeholder="Campo (ej: Marca del medidor)" value={m.label} onChange={e => {
                  const marcas_agua = data.marcas_agua.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x));
                  set({ marcas_agua });
                }} />
              </div>
              <div className="form-group">
                <input type="text" placeholder="Valor (ej: ZENNER)" value={m.value} onChange={e => {
                  const marcas_agua = data.marcas_agua.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x));
                  set({ marcas_agua });
                }} />
              </div>
              <button type="button" className="icon-btn danger" onClick={() => set({ marcas_agua: data.marcas_agua.filter((_, i) => i !== idx) })}><span className="material-symbols-outlined">close</span></button>
            </div>
          ))}
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={() => set({ marcas_agua: [...data.marcas_agua, { label: '', value: '' }] })}><span className="material-symbols-outlined">add</span> Agregar lectura</button>
          </div>

          <div className="receipt-editor-section-title">Acciones destacadas del mes</div>
          {data.acciones_del_mes.map((a, idx) => (
            <div key={idx} className="form-row">
              <div className="form-group">
                <input type="text" value={a} onChange={e => set({ acciones_del_mes: data.acciones_del_mes.map((x, i) => (i === idx ? e.target.value : x)) })} />
              </div>
              <button type="button" className="icon-btn danger" onClick={() => set({ acciones_del_mes: data.acciones_del_mes.filter((_, i) => i !== idx) })}><span className="material-symbols-outlined">close</span></button>
            </div>
          ))}
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={() => set({ acciones_del_mes: [...data.acciones_del_mes, ''] })}><span className="material-symbols-outlined">add</span> Agregar acción</button>
          </div>

          <div className="form-group">
            <label>Estado de morosidad</label>
            <input type="text" value={data.estado_morosidad} onChange={e => set({ estado_morosidad: e.target.value })} />
          </div>

          {error && <div className="error-message">{error}</div>}
      </div>

      <div className="form-actions">
        <button className="btn-cancel" onClick={onClose}><span className="material-symbols-outlined">close</span> Cancelar</button>
        <button onClick={handleSave} disabled={saving}><span className="material-symbols-outlined">save</span> {saving ? 'Guardando...' : 'Guardar recibo'}</button>
      </div>
      <small className="text-on-surface-variant">
        Usa «Ver vista previa» para revisar el recibo y «Imprimir / Guardar PDF» para exportarlo. Entidades de pago: {entidades.join(', ')}.
      </small>
    </div>
  );
}

function buildDefault(invoice: BillingInvoice): MaintenanceReceipt {
  const towerCode = invoice.departments?.towers?.code || '';
  const deptNumber = invoice.departments?.department_number || '';
  const today = new Date().toISOString().slice(0, 10);
  const items: MaintenanceReceipt['items'] = [];

  // Prefer the variable concepts captured in the Datos variables grid; when
  // the admin did not capture items, fall back to cuota + fines.
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
    condominio: '',
    titular: '',
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