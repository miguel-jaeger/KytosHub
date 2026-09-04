import { useState, useEffect, type FormEvent } from 'react';
import { useResidents } from '../hooks/useResidents';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { Resident, DepartmentNode } from '../types';

type SearchResident = Resident & {
  global_user?: boolean;
  role?: string;
};

const relLabel: Record<Resident['relationship_type'], string> = {
  PROPIETARIO: 'Propietario',
  FAMILIAR: 'Familiar',
  INQUILINO: 'Inquilino'
};

export function DepartmentModal({
  towerName,
  towerCode,
  floorNumber,
  department,
  departmentId,
  onClose
}: {
  towerName: string;
  towerCode: string;
  floorNumber: number;
  department: DepartmentNode;
  departmentId: string;
  onClose: () => void;
}) {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const { residents, loading: residentsLoading, createResident, deleteResident, fetchResidents } = useResidents(departmentId);
  const [showForm, setShowForm] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResident[]>([]);
  const [allCondoResidents, setAllCondoResidents] = useState<SearchResident[]>([]);
  const [searching, setSearching] = useState(false);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [resPage, setResPage] = useState(1);
  const [resPerPage, setResPerPage] = useState<number | 'all'>(10);
  const [searchPage, setSearchPage] = useState(1);
  const [searchPerPage, setSearchPerPage] = useState<number | 'all'>(10);

  const { slice: pagedResidents } = paginate(residents, resPage, resPerPage === 'all' ? residents.length : resPerPage);
  const { slice: pagedSearchResults } = paginate(searchResults, searchPage, searchPerPage === 'all' ? searchResults.length : searchPerPage);
  const [formData, setFormData] = useState<{
    full_name: string;
    document_type: Resident['document_type'];
    document_number: string;
    relationship_type: Resident['relationship_type'];
    is_primary_contact: boolean;
    email: string;
    phone: string;
  }>({
    full_name: '',
    document_type: 'DNI',
    document_number: '',
    relationship_type: 'PROPIETARIO',
    is_primary_contact: false,
    email: '',
    phone: ''
  });

  const doSearch = async () => {
    if (!schemaName) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: Resident[] | null; error: { message: string } | null }>('residents', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, include_users: true, tenant_id: condominium?.tenant_id }
      });
      if (fnError) throw fnError;
      const all = (data?.success ? (data.data || []) : []) as SearchResident[];
      setAllCondoResidents(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al buscar residentes');
    } finally {
      setSearching(false);
    }
  };

  const applySearch = (pool: SearchResident[]) => {
    const term = searchTerm.trim().toLowerCase();
    setSearchResults(pool.filter(r =>
      (r.full_name || '').toLowerCase().includes(term) ||
      (r.document_number || '').toLowerCase().includes(term) ||
      (r.email || '').toLowerCase().includes(term)
    ));
  };

  // Preload the condominium resident pool once when the search panel opens
  useEffect(() => {
    if (!showSearch) return;
    if (allCondoResidents.length > 0) return;
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch, schemaName]);

  // Filter in memory on each keystroke (no server round-trips)
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) { setSearchResults([]); return; }
    if (allCondoResidents.length > 0) {
      applySearch(allCondoResidents);
    } else {
      doSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchTerm]);

  const assignResident = async (r: Resident) => {
    if (!schemaName) return;
    setAssigningId(r.id);
    setError(null);
    setMessage(null);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');

      if (!r.id) {
        // Global user without a resident row: link them to this department
        const { data, error: fnError } = await invokeFunction<{ success: boolean; data?: Resident | null; error: { message: string } | null }>('residents', {
          method: 'POST',
          body: {
            action: 'link-user',
            schema_name: schemaName,
            user_id: r.user_id,
            department_id: departmentId
          }
        });
        if (fnError) throw fnError;
        if (!data?.success) { setError(data?.error?.message || 'No se pudo asignar el usuario'); return; }
        setMessage(`"${r.full_name}" fue agregado al Dpto ${department.department_number}.`);
      } else if (r.department_id === departmentId) {
        // Already in this department: nothing to do
        setMessage(`"${r.full_name}" ya está en el Dpto ${department.department_number}.`);
        await fetchResidents();
        return;
      } else if (r.department_id) {
        // Belongs to another department: add a copy here so it can live in both
        const { data, error: fnError } = await invokeFunction<{ success: boolean; data?: Resident | null; error: { message: string } | null }>('residents', {
          method: 'POST',
          body: {
            action: 'create',
            schema_name: schemaName,
            department_id: departmentId,
            full_name: r.full_name,
            document_type: r.document_type,
            document_number: r.document_number,
            relationship_type: r.relationship_type,
            is_primary_contact: r.is_primary_contact || false,
            email: r.email || null,
            phone: r.phone || null
          }
        });
        if (fnError) throw fnError;
        if (!data?.success) { setError(data?.error?.message || 'No se pudo asignar el residente'); return; }
        setMessage(`"${r.full_name}" fue agregado al Dpto ${department.department_number} (conserva su otro departamento).`);
      } else {
        // No department yet: assign it
        const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('residents', {
          method: 'POST',
          body: { action: 'update', id: r.id, schema_name: schemaName, department_id: departmentId }
        });
        if (fnError) throw fnError;
        if (!data?.success) { setError(data?.error?.message || 'No se pudo asignar el residente'); return; }
        setMessage(`"${r.full_name}" fue asignado al Dpto ${department.department_number}.`);
      }

      setSearchTerm('');
      setSearchResults([]);
      setShowSearch(false);
      setAllCondoResidents([]);
      await fetchResidents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setAssigningId(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!formData.full_name.trim() || !formData.document_number.trim()) {
      setError('Nombre y documento son obligatorios');
      return;
    }
    setSubmitting(true);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');
      const isOwner = formData.relationship_type === 'PROPIETARIO';
      let accountMessage = '';

      // Create the resident record
      await createResident({
        department_id: departmentId,
        ...formData
      });

      // If owner with email, create the auth account with default password
      if (isOwner && formData.email.trim()) {
        const { data: acctRes, error: acctErr } = await invokeFunction<{ success: boolean; data?: { default_password?: string }; error?: { message?: string } }>('resident-account', {
          method: 'POST',
          body: { action: 'create', email: formData.email, full_name: formData.full_name, document_number: formData.document_number, relationship_type: formData.relationship_type }
        });
        if (acctErr) {
          setError((acctErr as Error).message);
          setSubmitting(false);
          return;
        }
        if (!acctRes?.success) {
          setError(acctRes?.error?.message || 'No se pudo crear la cuenta del propietario');
          setSubmitting(false);
          return;
        }
        accountMessage = ` Cuenta creada. Contraseña: ${acctRes.data?.default_password || '12345678'}`;
      }

      setShowForm(false);
      setFormData({ full_name: '', document_type: 'DNI', document_number: '', relationship_type: 'PROPIETARIO', is_primary_contact: false, email: '', phone: '' });
      alert(`Residente agregado.${accountMessage}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar residente');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar este residente?')) return;
    try { await deleteResident(id); } catch (err) { alert((err as Error).message); }
  };

  const updateEditField = <K extends keyof Resident>(key: K, value: Resident[K]) => {
    setEditingResident(prev => prev ? { ...prev, [key]: value } : prev);
  };

  const handleSaveEdit = async () => {
    if (!editingResident) return;
    setSavingEdit(true);
    setError(null);
    try {
      const { invokeFunction } = await import('../../../lib/insforge');
      const updates: Partial<Resident> = {
        full_name: editingResident.full_name,
        document_type: editingResident.document_type,
        document_number: editingResident.document_number,
        relationship_type: editingResident.relationship_type,
        is_primary_contact: editingResident.is_primary_contact,
        email: editingResident.email || null,
        phone: editingResident.phone || null
      };
      const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('residents', {
        method: 'POST',
        body: { action: 'update', id: editingResident.id, schema_name: schemaName, ...updates }
      });
      if (fnError) throw fnError;
      if (!data?.success) { setError(data?.error?.message || 'No se pudo actualizar el residente'); return; }
      setEditingResident(null);
      await fetchResidents();
      setAllCondoResidents([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3>Dpto {department.department_number}</h3>
            <p>{towerName} ({towerCode}) - Piso {floorNumber} - {department.status}</p>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="residents-list">
            <div className="residents-header">
              <h4>Residentes ({residents.length})</h4>
              <div className="residents-actions">
                <button onClick={() => { setShowSearch(!showSearch); setShowForm(false); setError(null); setMessage(null); }}>
                  <span className="material-symbols-outlined">manage_search</span> {showSearch ? 'Cerrar' : 'Buscar existente'}
                </button>
                <button onClick={() => { setShowForm(!showForm); setShowSearch(false); setError(null); setMessage(null); }}>
                  <span className="material-symbols-outlined">{showForm ? 'close' : 'person_add'}</span> {showForm ? 'Cancelar' : 'Adicionar'}
                </button>
              </div>
            </div>

            {showSearch && (
              <div className="resident-search">
                <div className="form-group">
                  <label>Buscar residente por nombre, documento o correo</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Nombre, documento o correo..."
                    autoFocus
                  />
                </div>
                {searching ? (
                  <div className="loading-message">Buscando...</div>
                ) : searchResults.length === 0 ? (
                  searchTerm.trim() ? <p className="empty-text">Sin resultados.</p> : <p className="empty-text">Escriba para buscar residentes existentes.</p>
                ) : (
                  <table className="residents-table">
                    <thead>
                      <tr>
                        <th>Nombre</th>
                        <th>Documento</th>
                        <th>Departamento actual</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedSearchResults.map(r => (
                        <tr key={r.id ?? `global-${r.user_id}`}>
                          <td>{r.full_name}</td>
                          <td>{(r as unknown as { global_user?: boolean }).global_user ? 'Usuario del condominio' : `${r.document_type} ${r.document_number}`}</td>
                          <td>
                            {r.departments?.department_number
                              ? <>Dpto {r.departments.department_number}{r.departments.towers?.code ? ` (${r.departments.towers.code})` : ''}</>
                              : <span className="status-badge status-vacant">Sin asignar</span>}
                          </td>
                          <td>
                            <button className="btn-primary" onClick={() => assignResident(r)} disabled={assigningId === r.id || r.department_id === departmentId}>
                              {assigningId === r.id ? '...' : r.department_id === departmentId ? 'Ya está aquí' : r.department_id ? 'Agregar aquí' : 'Asignar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {searchResults.length > 0 && (
                  <PaginationBar
                    total={searchResults.length}
                    page={searchPage}
                    perPage={searchPerPage}
                    onPageChange={setSearchPage}
                    onPerPageChange={(n) => setSearchPerPage(n)}
                    itemLabel="resultado"
                  />
                )}
              </div>
            )}

            {message && <div className="success-message">{message}</div>}

            {residentsLoading ? (
              <div className="loading-message">Cargando residentes...</div>
            ) : residents.length === 0 ? (
              <p className="empty-text">No hay residentes en este departamento.</p>
            ) : (
              <>
                {/* Desktop table */}
                <table className="residents-table residents-desktop">
                  <thead>
                    <tr>
                      <th>Nombre</th>
                      <th>Documento</th>
                      <th>Tipo</th>
                      <th>Contacto</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedResidents.map(r => (
                      <tr key={r.id}>
                        <td>{r.full_name}{r.is_primary_contact ? ' ★' : ''}</td>
                        <td>{r.document_type} {r.document_number}</td>
                        <td>{relLabel[r.relationship_type]}</td>
                        <td>{r.email || r.phone || '-'}</td>
                        <td>
                          <div className="resident-row-actions">
                            <button className="btn-edit" onClick={() => setEditingResident(r)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                            <button className="btn-danger" onClick={() => handleDelete(r.id)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Mobile grid */}
                <div className="residents-mobile-grid">
                  {pagedResidents.map(r => (
                    <div key={r.id} className="resident-grid-card">
                      <div className="resident-grid-main">
                        <span className="resident-grid-name">{r.full_name}{r.is_primary_contact ? ' ★' : ''}</span>
                        <span className="resident-grid-meta">{r.document_type} {r.document_number}</span>
                      </div>
                      <div className="resident-grid-fields">
                        <div className="resident-grid-line"><span className="resident-grid-label">Tipo</span><span>{relLabel[r.relationship_type]}</span></div>
                        <div className="resident-grid-line"><span className="resident-grid-label">Contacto</span><span>{r.email || r.phone || '-'}</span></div>
                      </div>
                      <div className="resident-row-actions">
                        <button className="btn-edit" onClick={() => setEditingResident(r)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                        <button className="btn-danger" onClick={() => handleDelete(r.id)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {residents.length > 0 && (
              <PaginationBar
                total={residents.length}
                page={resPage}
                perPage={resPerPage}
                onPageChange={setResPage}
                onPerPageChange={(n) => setResPerPage(n)}
                itemLabel="residente"
              />
            )}
          </div>

          {editingResident && (
            <form className="resident-form" onSubmit={(e) => { e.preventDefault(); handleSaveEdit(); }}>
              <h4>Editar Residente</h4>

              <div className="form-group">
                <label>Nombre completo</label>
                <input type="text" value={editingResident.full_name} onChange={(e) => updateEditField('full_name', e.target.value)} required />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de documento</label>
                  <select value={editingResident.document_type} onChange={(e) => updateEditField('document_type', e.target.value as Resident['document_type'])}>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Número de documento</label>
                  <input type="text" value={editingResident.document_number} onChange={(e) => updateEditField('document_number', e.target.value)} required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Relación</label>
                  <select value={editingResident.relationship_type} onChange={(e) => updateEditField('relationship_type', e.target.value as Resident['relationship_type'])}>
                    <option value="PROPIETARIO">Propietario</option>
                    <option value="FAMILIAR">Familiar</option>
                    <option value="INQUILINO">Inquilino</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input type="text" value={editingResident.phone || ''} onChange={(e) => updateEditField('phone', e.target.value)} placeholder="+51 999 888 777" />
                </div>
              </div>

              <div className="form-group">
                <label>Email</label>
                <input type="email" value={editingResident.email || ''} onChange={(e) => updateEditField('email', e.target.value)} placeholder="correo@ejemplo.com" />
              </div>

              <div className="form-group checkbox">
                <label>
                  <input type="checkbox" checked={editingResident.is_primary_contact} onChange={(e) => updateEditField('is_primary_contact', e.target.checked)} />
                  Contacto principal
                </label>
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setEditingResident(null)}>Cancelar</button>
                <button type="submit" disabled={savingEdit}>{savingEdit ? 'Guardando...' : 'Guardar'}</button>
              </div>
            </form>
          )}

          {showForm && (
            <form className="resident-form" onSubmit={handleSubmit}>
              <h4>Agregar Residente</h4>

              <div className="form-group">
                <label>Nombre completo</label>
                <input type="text" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} placeholder="Juan Pérez" required />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de documento</label>
                  <select value={formData.document_type} onChange={e => setFormData({ ...formData, document_type: e.target.value as Resident['document_type'] })}>
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Número de documento</label>
                  <input type="text" value={formData.document_number} onChange={e => setFormData({ ...formData, document_number: e.target.value })} placeholder="12345678" required />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Relación</label>
                  <select value={formData.relationship_type} onChange={e => setFormData({ ...formData, relationship_type: e.target.value as Resident['relationship_type'] })}>
                    <option value="PROPIETARIO">Propietario</option>
                    <option value="FAMILIAR">Familiar</option>
                    <option value="INQUILINO">Inquilino</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input type="text" value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} placeholder="+51 999 888 777" />
                </div>
              </div>

              <div className="form-group">
                <label>Email {formData.relationship_type === 'PROPIETARIO' ? '(se creará cuenta de acceso)' : '(opcional)'}</label>
                <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="correo@ejemplo.com" />
              </div>

              <div className="form-group checkbox">
                <label>
                  <input type="checkbox" checked={formData.is_primary_contact} onChange={e => setFormData({ ...formData, is_primary_contact: e.target.checked })} />
                  Contacto principal
                </label>
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="form-actions">
                <button type="button" className="btn-cancel" onClick={() => setShowForm(false)}>Cerrar</button>
                <button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Adicionar'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}