import type { ParkingLayout, ParkingSpot, ParkingSpotType } from '../types';

interface Props {
  spots: ParkingSpot[];
  layout: ParkingLayout | null;
  onSpotClick?: (spot: ParkingSpot) => void;
  showLegend?: boolean;
}

export const SPOT_TYPE_LABELS: Record<ParkingSpotType, string> = {
  PROPIO: 'Propio',
  VISITA: 'Visita',
  ALQUILADO: 'Alquilado'
};

export const SPOT_TYPE_SHORT: Record<ParkingSpotType, string> = {
  PROPIO: 'P',
  VISITA: 'V',
  ALQUILADO: 'A'
};

function spotClass(spot: ParkingSpot): string {
  if (spot.inside || spot.status === 'OCUPADO') return 'plaza-occupied';
  if (spot.type === 'VISITA') return 'plaza-visita';
  if (spot.type === 'ALQUILADO') return 'plaza-rented';
  if (!spot.department_id) return 'plaza-unassigned';
  return 'plaza-free';
}

function spotStateLabel(spot: ParkingSpot): string {
  if (spot.inside || spot.status === 'OCUPADO') return 'Ocupada';
  if (spot.type === 'VISITA') return 'Visita disponible';
  if (spot.type === 'ALQUILADO') return 'Alquilada disponible';
  if (!spot.department_id) return 'Sin asignar a un departamento';
  return `Asignada a ${spot.departments?.department_number || 'depto'} · disponible`;
}

export function ParkingMap({ spots, layout, onSpotClick, showLegend }: Props) {
  if (spots.length === 0) {
    return (
      <div className="plaza-empty">
        <p>No hay plazas de estacionamiento generadas.</p>
        <p className="text-muted">Usa el paso "Generar layout" para crear filas y plazas con numeración automática.</p>
      </div>
    );
  }

  const countsForRow = (row: number): number => {
    if (!layout) return 1;
    if (Array.isArray(layout.spots_per_row)) return layout.spots_per_row[row - 1] || 1;
    return layout.spots_per_row;
  };

  // If we have a persisted layout, render rows x columns map
  const hasLayout = Boolean(
    layout && layout.rows > 0 &&
    (Array.isArray(layout.spots_per_row) ? layout.spots_per_row.length > 0 : layout.spots_per_row > 0) &&
    (spots[0]?.spot_row != null || spots[0]?.spot_index != null)
  );
  const spotByPos = new Map<string, ParkingSpot>();
  for (const s of spots) {
    if (s.spot_row != null && s.spot_index != null) spotByPos.set(`${s.spot_row}-${s.spot_index}`, s);
  }

  const rows = hasLayout ? layout!.rows : 1;

  const placed = [...Array(rows)].map((_, r) => {
    const row = r + 1;
    const cols = hasLayout ? countsForRow(row) : (spots.filter(s => s.spot_row === row).length || spots.length);
    const rowSpots: (ParkingSpot | null)[] = [];
    for (let c = 1; c <= cols; c++) {
      const s = hasLayout ? spotByPos.get(`${row}-${c}`) : spots.find(x => x.spot_index === c || x.spot_row === row);
      rowSpots.push(s || null);
    }
    return rowSpots;
  });

  return (
    <div className="plaza-map">
      {hasLayout && <div className="plaza-map-title">Mapa de estacionamiento</div>}

      <div className="plaza-map-grid">
        {placed.map((rowSpots, r) => (
          <div key={r} className="plaza-row">
            {hasLayout && <span className="plaza-row-label">Fila {r + 1}</span>}
            <div className={`plaza-row-spots${hasLayout ? ' plaza-row-grid' : ''}`}>
              {rowSpots.map((s, c) => (
                s ? (
                  <button
                    key={`${r}-${c}`}
                    className={`plaza-cell ${spotClass(s)}${onSpotClick ? ' plaza-cell-clickable' : ''}`}
                    onClick={onSpotClick ? () => onSpotClick(s) : undefined}
                    title={`Plaza ${s.spot_number} · ${SPOT_TYPE_LABELS[s.type] || s.type} · ${spotStateLabel(s)}${s.departments ? ` · Dpto ${s.departments.department_number}` : ''}`}
                  >
                    <strong>{s.spot_number}</strong>
                    {onSpotClick && <small>{SPOT_TYPE_SHORT[s.type] || '·'}</small>}
                    {s.departments && <small className="plaza-cell-dept">{s.departments.department_number}</small>}
                  </button>
                ) : (
                  <span key={`${r}-${c}`} className="plaza-cell plaza-cell-empty" />
                )
              ))}
            </div>
          </div>
        ))}
      </div>

      {showLegend && (
        <div className="plaza-legend">
          <span className="plaza-legend-item plaza-free">Asignada · libre</span>
          <span className="plaza-legend-item plaza-unassigned">Sin asignar</span>
          <span className="plaza-legend-item plaza-occupied">Ocupada</span>
          <span className="plaza-legend-item plaza-visita">Visita</span>
          <span className="plaza-legend-item plaza-rented">Alquilada</span>
        </div>
      )}
    </div>
  );
}