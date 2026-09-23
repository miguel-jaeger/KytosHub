import { useState } from 'react';
import { BillingReceipt } from './BillingReceipt';
import { MeterPhotoUpload } from './MeterPhotoUpload';
import type { BillingConfig, BillingConfigItem, BillingInvoice, MaintenanceReceipt, MaintenanceReceiptItem } from '../types';

function emptyItem(): MaintenanceReceiptItem {
  return { categoria: '', descripcion: '', cantidad: null, monto_total_gasto: null, importe_departamento: 0 };
}

function emptyAjuste(): MaintenanceReceiptItem {
  return { categoria: 'AJUSTES', descripcion: '', cantidad: null, monto_total_gasto: null, importe_departamento: 0 };
}

function computeTotals(items: MaintenanceReceiptItem[], ajustesItems: MaintenanceReceiptItem[]) {
  const subtotal = items.reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
  const ajustes = (ajustesItems || []).reduce((s, it) => s + (Number(it.importe_departamento) || 0), 0);
  return { subtotal, ajustes, total_mes: Math.max(0, subtotal - ajustes) };
}

function recomputeSedapal(it: MaintenanceReceiptItem): MaintenanceReceiptItem {
  const anterior = Number(it.lectura_anterior) || 0;
  const actual = Number(it.lectura_actual) || 0;
  const precio = Number(it.precio_unidad) || 0;
  const cantidad = Math.max(0, actual - anterior);
  const monto = Math.round(cantidad * precio * 10000) / 10000;
  return { ...it, cantidad: String(cantidad), monto_total_gasto: monto, importe_departamento: monto };
}

function isSedapalItem(it: MaintenanceReceiptItem): boolean {
  return String(it.categoria || '').toUpperCase() === 'SEDAPAL' || it.lectura_actual !== undefined;
}

export function BillingReceiptEditor({
  invoice,
  initial,
  config,
  uploadFolder,
  onSave,
  onClose
}: {
  invoice: BillingInvoice;
  initial: MaintenanceReceipt | null;
  config?: BillingConfig | null;
  uploadFolder?: string;
  onSave: (data: MaintenanceReceipt) => Promise<void>;
  onClose: () => void;
}) {
  const base = initial || buildDefault(invoice, config);
  const folder = uploadFolder || 'recibos';
  const [data, setData] = useState<MaintenanceReceipt>(base);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const set = (patch: Partial<MaintenanceReceipt>) => setData(prev => ({ ...prev, ...patch }));

  const updateItem = (idx: number, patch: Partial<MaintenanceReceiptItem>, recalcSedapal = false) => {
    setData(prev => {
      let items = prev.items.map((it, i) => (i === idx ? { ...it, ...patch } : it));
      if (recalcSedapal) items[idx] = recomputeSedapal(items[idx]);
      return { ...prev, items, ...computeTotals(items, prev.ajustes_items || []) };
    });
  };

  const addItem = () => setData(prev => {
    const items = [...prev.items, emptyItem()];
    return { ...prev, items, ...computeTotals(items, prev.ajustes_items || []) };
  });

  const removeItem = (idx: number) => {
    setData(prev => {
      const items = prev.items.filter((_, i) => i !== idx);
      return { ...prev, items, ...computeTotals(items, prev.ajustes_items || []) };
    });
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setData(prev => {
      const items = [...prev.items];
      const j = idx + dir;
      if (j < 0 || j >= items.length) return prev;
      [items[idx], items[j]] = [items[j], items[idx]];
      const totals = computeTotals(items, prev.ajustes_items || []);
      return { ...prev, items, ...totals };
    });
  };

  const resetSubtotals = () => {
    setData(prev => {
      let items = prev.items;
      items = items.map(it =>
        isSedapalItem(it) && (it.lectura_actual !== undefined || it.lectura_anterior !== undefined)
          ? recomputeSedapal(it)
          : it
      );
      return { ...prev, items, ...computeTotals(items, prev.ajustes_items || []) };
    });
  };

  const updateAjuste = (idx: number, patch: Partial<MaintenanceReceiptItem>) => {
    setData(prev => {
      const ajustesItems = (prev.ajustes_items || []).map((it, i) => (i === idx ? { ...it, ...patch } : it));
      return { ...prev, ajustes_items: ajustesItems, ...computeTotals(prev.items, ajustesItems) };
    });
  };

  const addAjuste = () => setData(prev => {
    const ajustesItems = [...(prev.ajustes_items || []), emptyAjuste()];
    return { ...prev, ajustes_items: ajustesItems, ...computeTotals(prev.items, ajustesItems) };
  });

  const removeAjuste = (idx: number) => {
    setData(prev => {
      const ajustesItems = (prev.ajustes_items || []).filter((_, i) => i !== idx);
      return { ...prev, ajustes_items: ajustesItems, ...computeTotals(prev.items, ajustesItems) };
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
  const hasAjustes = (data.ajustes_items || []).length > 0;

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
        <div className="receipt-editor-panel">
          <div className="receipt-editor-section-title">Datos del recibo</div>
          <div className="form-row">
            <div className="form-group">
              <label>N.º de recibo</label>
              <input type="text" value={data.numero_recibo} onChange={e => set({ numero_recibo: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Período</label>
              <input type="text" value={data.periodo} onChange={e => set({ periodo: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Condominio (emisor)</label>
              <input type="text" value={data.condominio} onChange={e => set({ condominio: e.target.value })} />
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
              <input type="number" min={0} step="any" value={String(data.deuda_total_acumulada)} onChange={e => set({ deuda_total_acumulada: Number(e.target.value) || 0 })} />
            </div>
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
          <div className="form-row">
            <div className="form-group">
              <label>Estado de morosidad</label>
              <input type="text" value={data.estado_morosidad} onChange={e => set({ estado_morosidad: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="receipt-editor-panel">
          <div className="receipt-editor-section-title">Conceptos del mes (por sección)</div>
          <div className="receipt-items-list">
            <div className="receipt-items-head">
              <span className="receipt-items-head-label">Sección</span>
              <span className="receipt-items-head-label">Descripción</span>
              <span className="receipt-items-head-label">Cantidad</span>
              <span className="receipt-items-head-label">Total gasto</span>
              <span className="receipt-items-head-label">Importe dpto</span>
              <span />
              <span />
              <span />
            </div>
            {data.items.map((it, idx) => (
              <div key={idx} className={isSedapalItem(it) ? 'receipt-item-wrap' : undefined}>
                <div className="receipt-item-row">
                  <div className="form-group">
                    <input type="text" placeholder="SEDAPAL, Administración..." value={it.categoria} onChange={e => updateItem(idx, { categoria: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="Descripción del concepto" value={it.descripcion} onChange={e => updateItem(idx, { descripcion: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <input type="text" placeholder="17.229 m³" value={it.cantidad || ''} onChange={e => updateItem(idx, { cantidad: e.target.value || null })} />
                  </div>
                  <div className="form-group">
                    <input type="number" step="any" placeholder="Total gasto" value={it.monto_total_gasto === null || it.monto_total_gasto === undefined ? '' : String(it.monto_total_gasto)} onChange={e => updateItem(idx, { monto_total_gasto: e.target.value === '' ? null : Number(e.target.value) })} />
                  </div>
                  <div className="form-group">
                    <input type="number" step="any" placeholder="Importe dpto" value={String(it.importe_departamento)} onChange={e => updateItem(idx, { importe_departamento: Number(e.target.value) || 0 })} />
                  </div>
                  <button type="button" className="icon-btn" title="Subir" onClick={() => moveItem(idx, -1)} disabled={idx === 0}><span className="material-symbols-outlined">arrow_upward</span></button>
                  <button type="button" className="icon-btn" title="Bajar" onClick={() => moveItem(idx, 1)} disabled={idx === data.items.length - 1}><span className="material-symbols-outlined">arrow_downward</span></button>
                  <button type="button" className="icon-btn danger" title="Eliminar" onClick={() => removeItem(idx)}><span className="material-symbols-outlined">close</span></button>
                </div>
                {isSedapalItem(it) && (
                  <div className="receipt-sedapal-fields">
                    <div className="form-group">
                      <label>Lectura anterior (m³)</label>
                      <input type="number" step="any" value={it.lectura_anterior === null || it.lectura_anterior === undefined ? '' : String(it.lectura_anterior)} onChange={e => updateItem(idx, { lectura_anterior: e.target.value === '' ? null : Number(e.target.value) }, true)} />
                    </div>
                    <div className="form-group">
                      <label>Lectura actual (m³)</label>
                      <input type="number" step="any" value={it.lectura_actual === null || it.lectura_actual === undefined ? '' : String(it.lectura_actual)} onChange={e => updateItem(idx, { lectura_actual: e.target.value === '' ? null : Number(e.target.value) }, true)} />
                    </div>
                    <div className="form-group">
                      <label>Precio por unidad (S/)</label>
                      <input type="number" step="any" value={it.precio_unidad === null || it.precio_unidad === undefined ? '' : String(it.precio_unidad)} onChange={e => updateItem(idx, { precio_unidad: e.target.value === '' ? null : Number(e.target.value) }, true)} />
                    </div>
                    <button type="button" className="btn-cancel" title="Calcular consumo = lectura actual - anterior" onClick={() => updateItem(idx, {}, true)}>
                      <span className="material-symbols-outlined">calculate</span> Recalcular
                    </button>
                  </div>
                )}
                {isSedapalItem(it) && (
                  <div className="receipt-sedapal-photo">
                    <MeterPhotoUpload value={it.foto_lectura} onChange={url => updateItem(idx, { foto_lectura: url })} folder={folder} />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={addItem}><span className="material-symbols-outlined">add</span> Agregar concepto</button>
            <button type="button" className="btn-cancel" onClick={resetSubtotals}><span className="material-symbols-outlined">calculate</span> Recalcular subtotales</button>
          </div>
        </div>

        <div className="receipt-editor-panel">
          <div className="receipt-editor-section-title">Ajustes del mes — Alquileres de tiendas</div>
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            Se incluyen únicamente cuando el departamento está al día con el pago de su mantenimiento. El importe se descuenta del total del recibo.
          </p>
          <div className="receipt-items-list">
            <div className="receipt-items-head" style={{ gridTemplateColumns: '1.8fr 0.8fr 0.9fr auto' }}>
              <span className="receipt-items-head-label">Descripción</span>
              <span className="receipt-items-head-label">Monto total</span>
              <span className="receipt-items-head-label">Importe a descontar</span>
              <span />
            </div>
            {(data.ajustes_items || []).map((it, idx) => (
              <div key={idx} className="receipt-item-row" style={{ gridTemplateColumns: '1.8fr 0.8fr 0.9fr auto' }}>
                <div className="form-group">
                  <input type="text" value={it.descripcion} onChange={e => updateAjuste(idx, { descripcion: e.target.value })} />
                </div>
                <div className="form-group">
                  <input type="number" step="any" placeholder="Monto total" value={it.monto_total_gasto === null || it.monto_total_gasto === undefined ? '' : String(it.monto_total_gasto)} onChange={e => updateAjuste(idx, { monto_total_gasto: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <input type="number" step="any" placeholder="Importe a descontar" value={String(it.importe_departamento)} onChange={e => updateAjuste(idx, { importe_departamento: Number(e.target.value) || 0 })} />
                </div>
                <button type="button" className="icon-btn danger" title="Eliminar" onClick={() => removeAjuste(idx)}><span className="material-symbols-outlined">close</span></button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={addAjuste}><span className="material-symbols-outlined">add</span> Agregar ajuste</button>
          </div>
          {!hasAjustes && (
            <small className="text-on-surface-variant">Sin ajustes; el departamento no calificaría para el descuento o no está al día.</small>
          )}
        </div>

        <div className="receipt-editor-panel">
          <div className="receipt-editor-section-title">Lectura del medidor de agua (opcional)</div>
          <div className="receipt-meter-list">
            {data.marcas_agua.map((m, idx) => (
              <div key={idx} className="receipt-meter-row">
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
          </div>
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={() => set({ marcas_agua: [...data.marcas_agua, { label: '', value: '' }] })}><span className="material-symbols-outlined">add</span> Agregar lectura</button>
          </div>
        </div>

        <div className="receipt-editor-panel">
          <div className="receipt-editor-section-title">Acciones destacadas del mes</div>
          {data.acciones_del_mes.map((a, idx) => (
            <div key={idx} className="receipt-action-row">
              <div className="form-group">
                <input type="text" value={a} onChange={e => set({ acciones_del_mes: data.acciones_del_mes.map((x, i) => (i === idx ? e.target.value : x)) })} />
              </div>
              <button type="button" className="icon-btn danger" onClick={() => set({ acciones_del_mes: data.acciones_del_mes.filter((_, i) => i !== idx) })}><span className="material-symbols-outlined">close</span></button>
            </div>
          ))}
          <div className="form-actions">
            <button type="button" className="btn-cancel" onClick={() => set({ acciones_del_mes: [...data.acciones_del_mes, ''] })}><span className="material-symbols-outlined">add</span> Agregar acción</button>
          </div>
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

function buildDefault(invoice: BillingInvoice, config: BillingConfig | null | undefined): MaintenanceReceipt {
  const towerCode = invoice.departments?.towers?.code || '';
  const deptNumber = invoice.departments?.department_number || '';
  const today = new Date().toISOString().slice(0, 10);
  const items: MaintenanceReceipt['items'] = [];

  const sections = config?.sections && Array.isArray(config.sections) && config.sections.length > 0 ? config.sections : [];
  if (sections.length > 0) {
    for (const section of sections) {
      for (const it of (section.items || [])) {
        const importe = Number(it.importe) || 0;
        if (!it.descripcion) continue;
        items.push({
          categoria: section.name || 'CONCEPTOS',
          descripcion: String(it.descripcion),
          cantidad: section.sedapal ? String(Number(it.cantidad) || 0) : null,
          monto_total_gasto: it.monto_total === null || it.monto_total === undefined ? null : Number(it.monto_total),
          importe_departamento: importe,
          ...(section.sedapal
            ? {
                lectura_anterior: it.lectura_anterior === null || it.lectura_anterior === undefined ? 0 : Number(it.lectura_anterior),
                lectura_actual: it.lectura_actual === null || it.lectura_actual === undefined ? 0 : Number(it.lectura_actual),
                precio_unidad: it.precio_unidad === null || it.precio_unidad === undefined ? 0 : Number(it.precio_unidad)
              }
            : {}),
          ...(typeof it.foto_lectura === 'string' && it.foto_lectura ? { foto_lectura: it.foto_lectura } : {})
        });
      }
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

  const ajustesItems: MaintenanceReceipt['items'] = [];
  let ajustes = 0;
  if ((invoice.al_dia ?? invoice.status === 'PAGADA') && config?.ajustes && config.ajustes.length > 0) {
    for (const it of config.ajustes as BillingConfigItem[]) {
      const importe = Number(it.importe) || 0;
      if (!it.descripcion) continue;
      ajustesItems.push({
        categoria: 'AJUSTES',
        descripcion: it.descripcion,
        cantidad: null,
        monto_total_gasto: it.monto_total === null || it.monto_total === undefined ? null : Number(it.monto_total),
        importe_departamento: importe
      });
      ajustes += importe;
    }
  }

  const marcas_agua: MaintenanceReceipt['marcas_agua'] = [];

  return {
    numero_recibo: `RCP-${(invoice.id || '').slice(0, 12).toUpperCase()}`,
    periodo: invoice.cycles?.label || 'Período',
    fecha_emision: invoice.created_at ? invoice.created_at.slice(0, 10) : today,
    fecha_vencimiento: invoice.due_date,
    moneda: 'Soles (PEN)',
    simbolo_moneda: 'S/',
    subtotal,
    ajustes_items: ajustesItems,
    ajustes,
    total_mes: Math.max(0, subtotal - ajustes),
    deuda_total_acumulada: Math.max(0, invoice.total - invoice.paid_amount),
    estado_morosidad: (invoice.al_dia ?? invoice.status === 'PAGADA')
      ? 'FELICITACIONES, sus pagos están al día'
      : 'ATENCIÓN: tiene pagos pendientes de mantenimiento',
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