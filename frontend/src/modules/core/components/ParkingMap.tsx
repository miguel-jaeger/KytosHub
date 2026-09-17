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
  DISCAPACITADOS: 'Discapacitados'
};

export const SPOT_TYPE_SHORT: Record<ParkingSpotType, string> = {
  PROPIO: 'P',
  VISITA: 'V',
  DISCAPACITADOS: 'D'
};

function spotClass(spot: ParkingSpot): string {
  if (spot.inside || spot.status === 'OCUPADO') return 'plaza-occupied';
  if (spot.type === 'VISITA') return 'plaza-visita';
  if (spot.type === 'DISCAPACITADOS') return 'plaza-disabled';
  return 'plaza-free';
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

  // If we have a persisted layout, render rows x columns map
  const hasLayout = Boolean(layout && layout.rows > 0 && layout.spots_per_row > 0 && (spots[0]?.spot_row != null || spots[0]?.spot_index != null));
  const spotByPos = new Map<string, ParkingSpot>();
  for (const s of spots) {
    if (s.spot_row != null && s.spot_index != null) spotByPos.set(`${s.spot_row}-${s.spot_index}`, s);
  }

  const rows = hasLayout ? layout!.rows : 1;

  const placed = [...Array(rows)].map((_, r) => {
    const row = r + 1;
    const cols = hasLayout ? layout!.spots_per_row : (spots.filter(s => s.spot_row === row).length || spots.length);
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
                    title={`Plaza ${s.spot_number} · ${SPOT_TYPE_LABELS[s.type] || s.type} · ${s.inside || s.status === 'OCUPADO' ? 'Ocupada' : 'Disponible'}`}
                  >
                    {s.spot_number}
                    {onSpotClick && <small>{SPOT_TYPE_SHORT[s.type] || '·'}</small>}
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
          <span className="plaza-legend-item plaza-free">Libre</span>
          <span className="plaza-legend-item plaza-occupied">Ocupada</span>
          <span className="plaza-legend-item plaza-visita">Visita</span>
          <span className="plaza-legend-item plaza-disabled">Discapacitados</span>
        </div>
      )}
    </div>
  );
}