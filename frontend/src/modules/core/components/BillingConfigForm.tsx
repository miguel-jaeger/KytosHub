import type { ChangeEvent } from 'react';
import type { BillingConfig, BillingConfigItem, BillingConfigSection } from '../types';

function uid(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
};

function emptyItem(descripcion = ''): BillingConfigItem {
  return {
    descripcion,
    monto_total: null,
    cantidad: null,
    precio_unidad: null,
    lectura_anterior: null,
    lectura_actual: null,
    importe: 0
  };
}

export function defaultBillingSections(): BillingConfigSection[] {
  return [
    {
      id: 'servicios-administrativos',
      name: 'Servicios administrativos',
      sedapal: false,
      items: [emptyItem('Servicio de Administración y Sistema de Recaudación')]
    },
    {
      id: 'mantenimiento-equipos',
      name: 'Mantenimiento de equipos',
      sedapal: false,
      items: [
        emptyItem('Mantenimiento Preventivo de equipos y áreas comunes'),
        emptyItem('Mantenimiento Preventivo de Maquinarias y Equipos de su torre')
      ]
    },
    {
      id: 'fondo-contingencia',
      name: 'Fondo de contingencia',
      sedapal: false,
      items: [
        emptyItem('Fondos de contingencia, emergencia y correctivos de áreas comunes'),
        emptyItem('Fondos de contingencia, emergencia y correctivos de su torre')
      ]
    },
    {
      id: 'mantenimiento-ascensores',
      name: 'Mantenimiento preventivo y correctivo de ascensores',
      sedapal: false,
      items: [
        emptyItem('Mantenimiento preventivo de ascensores 01 y 02 de su torre'),
        emptyItem('Mantenimiento Correctivo de ascensores 01 y 02 de su torre')
      ]
    },
    {
      id: 'sedapal',
      name: 'SEDAPAL',
      sedapal: true,
      items: [
        { ...emptyItem('Servicio de agua'), lectura_anterior: 0, lectura_actual: 0, precio_unidad: 0, cantidad: 0, monto_total: 0 }
      ]
    }
  ];
}

export function defaultBillingAjustes(): BillingConfigItem[] {
  return [emptyItem('Alquileres de tiendas')];
}

export function defaultBillingConfig(): BillingConfig {
  return {
    default_fee: 150,
    due_days: 5,
    autolink_cart_fines: true,
    sections: defaultBillingSections(),
    ajustes: defaultBillingAjustes()
  };
}

export function normalizeBillingConfig(cfg: Partial<BillingConfig> | Record<string, unknown> | null | undefined): BillingConfig {
  const base = defaultBillingConfig();
  const src = (cfg && typeof cfg === 'object' ? cfg : {}) as Record<string, unknown>;
  const sections = Array.isArray(src.sections)
    ? (src.sections as Record<string, unknown>[]).map((s, si) => ({
        id: String(s.id || `s_${si}`),
        name: String(s.name || `Sección ${si + 1}`),
        sedapal: s.sedapal === true,
        items: Array.isArray(s.items)
          ? (s.items as Record<string, unknown>[]).map(it => ({
              descripcion: String(it.descripcion || ''),
              monto_total: it.monto_total === null || it.monto_total === undefined ? null : num(it.monto_total),
              cantidad: it.cantidad === null || it.cantidad === undefined ? null : num(it.cantidad),
              precio_unidad: it.precio_unidad === null || it.precio_unidad === undefined ? null : num(it.precio_unidad),
              lectura_anterior: it.lectura_anterior === null || it.lectura_anterior === undefined ? null : num(it.lectura_anterior),
              lectura_actual: it.lectura_actual === null || it.lectura_actual === undefined ? null : num(it.lectura_actual),
              importe: num(it.importe)
            }))
          : []
      }))
    : base.sections;
  const ajustes = Array.isArray(src.ajustes)
    ? (src.ajustes as Record<string, unknown>[]).map(it => ({
        descripcion: String(it.descripcion || ''),
        monto_total: it.monto_total === null || it.monto_total === undefined ? null : num(it.monto_total),
        cantidad: null,
        precio_unidad: null,
        lectura_anterior: null,
        lectura_actual: null,
        importe: num(it.importe)
      }))
    : base.ajustes;
  return {
    default_fee: num(src.default_fee, base.default_fee),
    due_days: Math.round(num(src.due_days, base.due_days)),
    autolink_cart_fines: src.autolink_cart_fines !== false,
    sections,
    ajustes
  };
}

function moneyDisplay(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

export function BillingConfigForm({
  value,
  onChange,
  disabled
}: {
  value: BillingConfig;
  onChange: (next: BillingConfig) => void;
  disabled?: boolean;
}) {
  const patchSections = (sections: BillingConfigSection[]) => onChange({ ...value, sections });
  const patchAjustes = (ajustes: BillingConfigItem[]) => onChange({ ...value, ajustes });

  const updateSection = (si: number, patch: Partial<BillingConfigSection>) => {
    const sections = value.sections.map((s, i) => (i === si ? { ...s, ...patch } : s));
    patchSections(sections);
  };

  const updateItem = (si: number, ii: number, patch: Partial<BillingConfigItem>, recomputeSedapal = false) => {
    const next = value.sections.map((s, i) => {
      if (i !== si) return s;
      const updated = s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it));
      if (recomputeSedapal && s.sedapal) {
        const raw = updated[ii];
        const anterior = raw.lectura_anterior ?? 0;
        const actual = raw.lectura_actual ?? 0;
        const precio = raw.precio_unidad ?? 0;
        const cantidad = Math.max(0, actual - anterior);
        const monto = Math.round(cantidad * precio * 100) / 100;
        updated[ii] = { ...raw, cantidad, monto_total: monto, importe: monto };
      }
      return { ...s, items: updated };
    });
    patchSections(next);
  };

  const addItem = (si: number) => {
    updateSection(si, { items: [...value.sections[si].items, emptyItem()] });
  };

  const removeItem = (si: number, ii: number) => {
    const section = value.sections[si];
    if (section.items.length <= 1) return;
    updateSection(si, { items: section.items.filter((_, j) => j !== ii) });
  };

  const addSection = () => {
    patchSections([...value.sections, { id: uid(), name: 'Nueva sección', sedapal: false, items: [emptyItem()] }]);
  };

  const removeSection = (si: number) => {
    if (value.sections.length <= 1) return;
    patchSections(value.sections.filter((_, i) => i !== si));
  };

  const updateAjuste = (ii: number, patch: Partial<BillingConfigItem>) => {
    patchAjustes(value.ajustes.map((it, j) => (j === ii ? { ...it, ...patch } : it)));
  };

  const addAjuste = () => patchAjustes([...value.ajustes, emptyItem()]);
  const removeAjuste = (ii: number) => {
    if (value.ajustes.length <= 1) return;
    patchAjustes(value.ajustes.filter((_, j) => j !== ii));
  };

  const conceptSum = value.sections.reduce((s, sec) => s + sec.items.reduce((x, it) => x + num(it.importe), 0), 0);
  const ajusteSum = value.ajustes.reduce((s, it) => s + num(it.importe), 0);

  const numberInputProps = (v: number | null | undefined, onChangeVal: (n: number | null) => void) => ({
    type: 'number' as const,
    min: 0,
    step: '0.01',
    disabled,
    value: moneyDisplay(v),
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChangeVal(e.target.value === '' ? null : Number(e.target.value))
  });

  return (
    <div className="billing-config">
      <div className="module-example">
        <span className="material-symbols-outlined">info</span>
        <span>
          Define las secciones y conceptos que aparecerán en el recibo de mantenimiento. En SEDAPAL se registra la lectura del medidor y el precio por unidad; el resto de secciones solo registra el monto total y el importe a pagar. Puedes agregar secciones nuevas con sus propios ítems.
        </span>
      </div>

      <div className="billing-config-summary">
        <span><strong>Total conceptos a pagar:</strong> S/ {num(conceptSum).toFixed(2)}</span>
        <span><strong>Total ajustes (descuento):</strong> S/ {num(ajusteSum).toFixed(2)}</span>
      </div>

      <div className="billing-config-sections">
        {value.sections.map((section, si) => (
          <div key={section.id} className="billing-section-card">
            <div className="billing-section-head">
              <div className="form-group">
                <label>Nombre de la sección</label>
                <input type="text" disabled={disabled} value={section.name} onChange={e => updateSection(si, { name: e.target.value })} />
              </div>
              <div className="billing-section-tools">
                <label className="billing-check">
                  <input type="checkbox" disabled={disabled} checked={section.sedapal} onChange={e => updateSection(si, { sedapal: e.target.checked })} />
                  SEDAPAL (medidor de agua)
                </label>
                {!disabled && (
                  <button type="button" className="icon-btn danger" title="Eliminar sección" onClick={() => removeSection(si)}>
                    <span className="material-symbols-outlined">close</span>
                  </button>
                )}
              </div>
            </div>

            {section.sedapal ? (
              <div className="billing-items">
                <div className="billing-items-head billing-items-head-sedapal">
                  <span>Descripción</span>
                  <span>Lectura anterior</span>
                  <span>Lectura actual</span>
                  <span>Precio por unidad (S/)</span>
                  <span>Cantidad</span>
                  <span>Monto total (S/)</span>
                  <span>Importe (S/)</span>
                  <span />
                </div>
                {section.items.map((it, ii) => (
                  <div key={ii} className="billing-item-row billing-item-row-sedapal">
                    <div className="form-group"><input type="text" disabled={disabled} value={it.descripcion} onChange={e => updateItem(si, ii, { descripcion: e.target.value })} /></div>
                    <div className="form-group"><input {...numberInputProps(it.lectura_anterior, n => updateItem(si, ii, { lectura_anterior: n }, true))} /></div>
                    <div className="form-group"><input {...numberInputProps(it.lectura_actual, n => updateItem(si, ii, { lectura_actual: n }, true))} /></div>
                    <div className="form-group"><input {...numberInputProps(it.precio_unidad, n => updateItem(si, ii, { precio_unidad: n }, true))} /></div>
                    <div className="form-group"><input disabled readOnly value={moneyDisplay(it.cantidad)} /></div>
                    <div className="form-group"><input disabled readOnly value={moneyDisplay(it.monto_total)} /></div>
                    <div className="form-group"><input {...numberInputProps(it.importe, n => updateItem(si, ii, { importe: n ?? 0 }))} /></div>
                    {!disabled && (
                      <button type="button" className="icon-btn danger" title="Eliminar ítem" onClick={() => removeItem(si, ii)}>
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="billing-items">
                <div className="billing-items-head">
                  <span>Descripción</span>
                  <span>Monto total (S/)</span>
                  <span>Importe a pagar (S/)</span>
                  <span />
                </div>
                {section.items.map((it, ii) => (
                  <div key={ii} className="billing-item-row">
                    <div className="form-group"><input type="text" disabled={disabled} value={it.descripcion} onChange={e => updateItem(si, ii, { descripcion: e.target.value })} /></div>
                    <div className="form-group"><input {...numberInputProps(it.monto_total, n => updateItem(si, ii, { monto_total: n }))} /></div>
                    <div className="form-group"><input {...numberInputProps(it.importe, n => updateItem(si, ii, { importe: n ?? 0 }))} /></div>
                    {!disabled && (
                      <button type="button" className="icon-btn danger" title="Eliminar ítem" onClick={() => removeItem(si, ii)}>
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {!disabled && (
              <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                <button type="button" className="btn-cancel" onClick={() => addItem(si)}>
                  <span className="material-symbols-outlined">add</span> Agregar ítem
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!disabled && (
        <button type="button" className="btn-cancel" onClick={addSection}>
          <span className="material-symbols-outlined">add</span> Agregar sección
        </button>
      )}

      <div className="billing-section-card billing-section-ajustes">
        <div className="billing-section-head">
          <div className="form-group">
            <label>Nombre de la sección</label>
            <input type="text" disabled value="Ajustes" />
          </div>
          <div className="billing-section-tools">
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>Solo se incluye si el departamento está al día con su mantenimiento</span>
          </div>
        </div>
        <div className="billing-items">
          <div className="billing-items-head">
            <span>Descripción</span>
            <span>Monto total (S/)</span>
            <span>Importe a descontar (S/)</span>
            <span />
          </div>
          {value.ajustes.map((it, ii) => (
            <div key={ii} className="billing-item-row">
              <div className="form-group"><input type="text" disabled={disabled} value={it.descripcion} onChange={e => updateAjuste(ii, { descripcion: e.target.value })} /></div>
              <div className="form-group"><input {...numberInputProps(it.monto_total, n => updateAjuste(ii, { monto_total: n }))} /></div>
              <div className="form-group"><input {...numberInputProps(it.importe, n => updateAjuste(ii, { importe: n ?? 0 }))} /></div>
              {!disabled && (
                <button type="button" className="icon-btn danger" title="Eliminar ítem" onClick={() => removeAjuste(ii)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              )}
            </div>
          ))}
        </div>
        {!disabled && (
          <div className="form-actions" style={{ justifyContent: 'flex-start', marginTop: '0.5rem' }}>
            <button type="button" className="btn-cancel" onClick={addAjuste}>
              <span className="material-symbols-outlined">add</span> Agregar ítem de ajuste
            </button>
          </div>
        )}
      </div>
    </div>
  );
}