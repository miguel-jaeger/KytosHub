import type { MaintenanceReceipt } from '../types';

function fmt(n: number): string {
  return (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(n: number): string {
  return (Number(n) || 0).toFixed(2);
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-PE');
}

function groupByCategory(items: MaintenanceReceipt['items']): Array<{ categoria: string; rows: typeof items }> {
  const order: string[] = [];
  const map = new Map<string, typeof items>();
  for (const it of items) {
    if (!map.has(it.categoria)) {
      order.push(it.categoria);
      map.set(it.categoria, []);
    }
    map.get(it.categoria)!.push(it);
  }
  return order.map(c => ({ categoria: c, rows: map.get(c)! }));
}

export function BillingReceipt({ data }: { data: MaintenanceReceipt }) {
  const groups = groupByCategory(data.items);

  return (
    <div className="receipt-print">
      <header className="receipt-header">
        <div className="receipt-brand">
          <h1>{data.condominio}</h1>
          <div className="receipt-seal">CUOTA DE MANTENIMIENTO</div>
        </div>
        <div className="receipt-number">
          <span>RECIBO N.º {data.numero_recibo}</span>
          <small>{data.periodo}</small>
        </div>
      </header>

      <section className="receipt-data">
        <div className="receipt-panel">
          <h4>Datos del recibo</h4>
          <p><span>Periodo</span><strong>{data.periodo}</strong></p>
          <p><span>Emisión</span><strong>{fmtDate(data.fecha_emision)}</strong></p>
          <p><span>Vencimiento</span><strong>{fmtDate(data.fecha_vencimiento)}</strong></p>
          <p><span>Moneda</span><strong>{data.moneda}</strong></p>
          <div className="receipt-morosidad ok">{data.estado_morosidad}</div>
        </div>
        <div className="receipt-panel">
          <h4>Destinatario y recaudación</h4>
          <p><span>Titular</span><strong>{data.titular}</strong></p>
          <p><span>Vivienda</span><strong>{data.identificador_vivienda}</strong></p>
          <p><span>Edificio / Dpto.</span><strong>{data.edificio} · {data.departamento}</strong></p>
          <p><span>Código de recaudación</span><strong>{data.codigo_recaudacion}</strong></p>
          <p><span>Plataforma</span><strong>{data.plataforma_recaudacion}</strong></p>
        </div>
      </section>

      <div className="receipt-section-title">Detalle de conceptos del mes</div>
      <table className="receipt-table">
        <thead>
          <tr>
            <th className="desc">Descripción</th>
            <th className="cant">Cantidad / Lectura</th>
            <th className="num">Total gasto ({data.simbolo_moneda})</th>
            <th className="num">Importe del departamento ({data.simbolo_moneda})</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ categoria, rows }) => (
            <ReceiptCategory key={categoria} categoria={categoria} rows={rows} simbolo={data.simbolo_moneda} />
          ))}
        </tbody>
      </table>

      {data.ajustes_items && data.ajustes_items.length > 0 && (
        <>
          <div className="receipt-section-title">Ajustes del mes</div>
          <table className="receipt-table">
            <thead>
              <tr>
                <th className="desc">Descripción</th>
                <th className="cant">Cantidad / Lectura</th>
                <th className="num">Total ({data.simbolo_moneda})</th>
                <th className="num">Importe a descontar ({data.simbolo_moneda})</th>
              </tr>
            </thead>
            <tbody>
              {data.ajustes_items.map((r, i) => (
                <tr key={i}>
                  <td>{r.descripcion}</td>
                  <td className="cant">{r.cantidad || '—'}</td>
                  <td className="num">{r.monto_total_gasto !== null && r.monto_total_gasto !== undefined ? `${data.simbolo_moneda} ${fmt(r.monto_total_gasto)}` : '—'}</td>
                  <td className="num">-{data.simbolo_moneda} {fmtShort(r.importe_departamento)}</td>
                </tr>
              ))}
              <tr className="receipt-subtotal">
                <td colSpan={3}>Total a descontar</td>
                <td className="num">-{data.simbolo_moneda} {fmtShort(data.ajustes_items.reduce((s, r) => s + (Number(r.importe_departamento) || 0), 0))}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      <div className="receipt-totals">
        <div className="receipt-totals-card">
          <p><span>Subtotal del mes</span><strong>{data.simbolo_moneda} {fmt(data.subtotal)}</strong></p>
          <p><span>Ajustes aplicados al mes</span><strong>{data.simbolo_moneda} {fmt(data.ajustes)}</strong></p>
          <p className="grand"><span>TOTAL MES</span><strong>{data.simbolo_moneda} {fmt(data.total_mes)}</strong></p>
          <p><span>Deuda total acumulada</span><strong>{data.simbolo_moneda} {fmt(data.deuda_total_acumulada)}</strong></p>
        </div>
      </div>

      {data.marcas_agua.length > 0 && (
        <>
          <div className="receipt-section-title">Evidencia de lectura del medidor de agua</div>
          <div className="receipt-meter">
            {data.marcas_agua.map(m => (
              <div key={m.label} className="receipt-meter-item">
                <span>{m.label}</span>
                <strong>{m.value}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      <section className="receipt-payment">
        <h3>Instrucciones de pago</h3>
        <p>
          Realice el pago a través de la plataforma <strong>{data.plataforma_recaudacion}</strong> en cualquiera de las
          siguientes entidades:
        </p>
        <p className="receipt-entities">
          {data.entidades_autorizadas.map(e => <span key={e}>{e}</span>)}
        </p>
        <p>
          Regla del código de pago: {data.regla_codigo_pago}<br />
          Código de su departamento: <strong className="receipt-code">{data.codigo_recaudacion}</strong>
        </p>
        <ol>
          {data.pasos_pago.map((p, i) => <li key={i}>{p}</li>)}
        </ol>
        <ul>
          {data.notas_pago.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      </section>

      {data.acciones_del_mes.length > 0 && (
        <section className="receipt-actions">
          <div className="receipt-section-title">Informe operativo - Acciones destacadas del mes</div>
          <ul>
            {data.acciones_del_mes.map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </section>
      )}

      <footer className="receipt-footer">
        Generado por {data.plataforma_software} · Ante cualquier consulta: {data.contacto_soporte}
      </footer>
    </div>
  );
}

function ReceiptCategory({ categoria, rows, simbolo }: { categoria: string; rows: MaintenanceReceipt['items']; simbolo: string }) {
  const subtotal = rows.reduce((s, r) => s + (Number(r.importe_departamento) || 0), 0);
  return (
    <>
      <tr className="receipt-category"><td colSpan={4}>{categoria}</td></tr>
      {rows.map((r, i) => (
        <tr key={i}>
          <td>
            {r.descripcion}
            {r.lectura_actual !== undefined && (
              <div className="receipt-reading-sub">
                Lectura anterior: {(Number(r.lectura_anterior) || 0).toFixed(2)} m³ · Lectura actual: {(Number(r.lectura_actual) || 0).toFixed(2)} m³
                {r.precio_unidad !== undefined && <> · Precio por unidad: {simbolo} {(Number(r.precio_unidad) || 0).toFixed(2)}</>}
              </div>
            )}
          </td>
          <td className="cant">{r.cantidad || '—'}</td>
          <td className="num">{r.monto_total_gasto !== null && r.monto_total_gasto !== undefined ? `${simbolo} ${fmt(r.monto_total_gasto)}` : '—'}</td>
          <td className="num">{simbolo} {fmtShort(r.importe_departamento)}</td>
        </tr>
      ))}
      <tr className="receipt-subtotal">
        <td colSpan={3}>Subtotal {categoria}</td>
        <td className="num">{simbolo} {fmtShort(subtotal)}</td>
      </tr>
    </>
  );
}