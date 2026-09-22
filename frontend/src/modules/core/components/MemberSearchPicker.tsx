import { useState, useEffect, useRef } from 'react';

export interface MemberOption {
  id: string;
  label: string;
  sublabel?: string;
}

export function MemberSearchPicker({
  value,
  options,
  onChange,
  placeholder,
  disabled
}: {
  value: string;
  options: MemberOption[];
  onChange: (id: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find(o => o.id === value) || null;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o => `${o.label} ${o.sublabel || ''}`.toLowerCase().includes(q)).slice(0, 8)
    : options.slice(0, 8);

  const resetInput = () => {
    setQuery(selected ? selected.label : '');
  };

  return (
    <div className="member-search" ref={containerRef}>
      {selected ? (
        <div className="member-search-selected">
          <span className="member-search-selected-label">{selected.label}{selected.sublabel ? ` · ${selected.sublabel}` : ''}</span>
          <button
            type="button"
            className="icon-btn"
            disabled={disabled}
            title="Quitar selección"
            onClick={() => { onChange(''); setQuery(''); setOpen(false); }}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      ) : (
        <>
          <div className="search-bar" onClick={() => setOpen(true)}>
            <span className="material-symbols-outlined search-icon">search</span>
            <input
              type="text"
              value={query}
              disabled={disabled}
              placeholder={placeholder}
              onFocus={() => setOpen(true)}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
            />
          </div>
          {open && options.length > 0 && (
            <div className="condo-picker-dropdown member-search-dropdown">
              {filtered.length === 0 ? (
                <div className="condo-picker-empty">Sin resultados</div>
              ) : (
                filtered.map(o => (
                  <button
                    key={o.id}
                    type="button"
                    className="condo-picker-item"
                    onClick={() => { onChange(o.id); setOpen(false); resetInput(); }}
                  >
                    <span className="material-symbols-outlined">person</span>
                    <span>
                      {o.label}
                      {o.sublabel ? <small className="member-search-sublabel"> · {o.sublabel}</small> : null}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}