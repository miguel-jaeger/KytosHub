interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (p: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Anterior</button>
      <span>Página {page} de {totalPages}</span>
      <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Siguiente</button>
    </div>
  );
}

interface PaginationBarProps {
  total: number;
  page: number;
  perPage: number | 'all';
  onPageChange: (p: number) => void;
  onPerPageChange: (n: number | 'all') => void;
  itemLabel?: string;
}

const PAGE_SIZES = [10, 50, 100];

export function PaginationBar({ total, page, perPage, onPageChange, onPerPageChange, itemLabel = 'elemento' }: PaginationBarProps) {
  const size = perPage === 'all' ? total : perPage;
  const totalPages = total === 0 ? 0 : Math.ceil(total / size);
  const safePage = Math.min(page, totalPages || 1);
  const from = total === 0 ? 0 : (safePage - 1) * size + 1;
  const to = total === 0 ? 0 : Math.min(safePage * size, total);
  const plural = total !== 1;

  return (
    <div className="pagination-bar">
      <div className="condo-count">
        <span className="material-symbols-outlined">list_alt</span>
        Listando {from} - {to} de {total} {itemLabel}{plural ? 's' : ''}
      </div>
      <div className="pagination-controls">
        <div className="pagination-size">
          <label>Filas:</label>
          <select value={perPage} onChange={(e) => { onPerPageChange(e.target.value === 'all' ? 'all' : Number(e.target.value)); onPageChange(1); }}>
            {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            <option value="all">Todos</option>
          </select>
        </div>
        <Pagination page={safePage} totalPages={totalPages} onPageChange={onPageChange} />
      </div>
    </div>
  );
}

export function paginate<T>(items: T[], page: number, perPage: number) {
  const totalPages = perPage <= 0 ? 1 : Math.ceil(items.length / perPage);
  const start = (page - 1) * perPage;
  return { slice: items.slice(start, start + perPage), totalPages };
}