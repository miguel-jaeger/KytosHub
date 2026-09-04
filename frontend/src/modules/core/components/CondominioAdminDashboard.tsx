import { useState, useEffect, useRef } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useAuth } from '../../../contexts/AuthContext';
import { useCondominiums } from '../hooks/useCondominiums';
import { PaginationBar, paginate } from '../../../components/Pagination';

interface TenantUser {
  id: string;
  user_id: string;
  role: string;
  status: string;
  created_at: string;
  name?: string;
  email?: string;
  tenant_id?: string;
  tenant_name?: string;
  schema_name?: string;
  source?: 'tenant_user' | 'resident';
  users_global?: { email: string; is_superadmin: boolean; document_type?: string; document_number?: string; phone?: string } | null;
  document_type?: string;
  document_number?: string;
  phone?: string;
}

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  SECURITY_AGENT: 'Agente de Seguridad',
  RESIDENT: 'Residente',
  VISITOR: 'Visitante'
};

interface ImportRow {
  name: string;
  email: string;
  document_type: string;
  document_number: string;
  phone: string;
}

interface ImportColumnIndexes {
  name?: number;
  email?: number;
  document?: number;
  phone?: number;
}

interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ email: string; reason: string }>;
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function detectImportColumns(headers: string[]): ImportColumnIndexes {
  const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const idx: ImportColumnIndexes = {};
  headers.forEach((h, i) => {
    const key = norm(h);
    if (!key) return;
    if (['nombre', 'name', 'nombres', 'nombre completo'].includes(key)) idx.name = i;
    else if (['correo', 'email', 'correo electronico', 'correo electrónico'].includes(key)) idx.email = i;
    else if (['dni', 'documento', 'numero de documento', 'nro documento', 'nro dni'].includes(key)) idx.document = i;
    else if (['telefono', 'phone', 'celular', 'numero de telefono'].includes(key)) idx.phone = i;
  });
  return idx;
}

function mapImportRows(dataRows: string[][], idx: ImportColumnIndexes): { rows: ImportRow[]; invalid: number } {
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  for (const cells of dataRows) {
    const at = (i?: number) => (i === undefined ? '' : (cells[i] ?? '')).trim();
    const name = at(idx.name);
    const email = at(idx.email).toLowerCase();
    const document_number = at(idx.document);
    const phone = at(idx.phone);
    if (!name || !email || !EMAIL_RE.test(email)) { invalid++; continue; }
    if (seen.has(email)) { invalid++; continue; }
    seen.add(email);
    rows.push({ name, email, document_type: 'DNI', document_number, phone });
  }
  return { rows, invalid };
}

export function CondominioAdminDashboard() {
  const { condominium, setCondominium } = useCondominium();
  const { user } = useAuth();
  const { condominiums } = useCondominiums();
  const isSuperAdmin = user?.email === 'miguel.jaeger@gmail.com';
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [newUser, setNewUser] = useState({ email: '', name: '', role: 'RESIDENT', tenant_id: '', document_type: 'DNI', document_number: '', phone: '' });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState<number | 'all'>(10);
  const [viewAllCondos, setViewAllCondos] = useState<boolean>(isSuperAdmin);

  const [condoSearch, setCondoSearch] = useState(condominium?.name || '');
  const [condoDropdownOpen, setCondoDropdownOpen] = useState(false);
  const condoDropdownRef = useRef<HTMLDivElement>(null);

  const [addCondoSearch, setAddCondoSearch] = useState('');
  const [addCondoDropdownOpen, setAddCondoDropdownOpen] = useState(false);
  const addCondoDropdownRef = useRef<HTMLDivElement>(null);

  const [editCondoSearch, setEditCondoSearch] = useState('');
  const [editCondoDropdownOpen, setEditCondoDropdownOpen] = useState(false);
  const editCondoDropdownRef = useRef<HTMLDivElement>(null);
  const [editOriginalTenant, setEditOriginalTenant] = useState('');
  const [editOriginalSchema, setEditOriginalSchema] = useState('');

  const [showImportForm, setShowImportForm] = useState(false);
  const [importTargetTenant, setImportTargetTenant] = useState('');
  const [importCondoSearch, setImportCondoSearch] = useState('');
  const [importCondoDropdownOpen, setImportCondoDropdownOpen] = useState(false);
  const importCondoDropdownRef = useRef<HTMLDivElement>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importPreview, setImportPreview] = useState<ImportRow[]>([]);
  const [importInvalidCount, setImportInvalidCount] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  const openAddForm = () => {
    const initial = condominium?.tenant_id || '';
    const initialName = condominiums.find(c => c.id === initial)?.name || '';
    setNewUser({ email: '', name: '', role: 'RESIDENT', tenant_id: initial, document_type: 'DNI', document_number: '', phone: '' });
    setAddCondoSearch(initialName);
    setShowAddForm(true);
  };
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = async () => {
    try {
      if (!viewAllCondos && !condominium?.tenant_id) { setUsers([]); setLoading(false); return; }
      setLoading(true);
      setError(null);
      const body = viewAllCondos
        ? { action: 'list-all' }
        : { action: 'list', tenant_id: condominium?.tenant_id };
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: TenantUser[] | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body
      });

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setUsers(data.data);
        setPage(1);
      } else {
        setError(data?.error?.message || 'Error al cargar usuarios');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [condominium?.tenant_id, viewAllCondos]);

  useEffect(() => {
    if (isSuperAdmin || !user) return;
    invokeFunction<{ success: boolean; data: { tenant_id: string }[] | null }>('list-condominium-users', {
      method: 'POST',
      body: { action: 'list-by-user', user_id: user.id }
    }).then(({ data }) => {
      const first = data?.data?.[0]?.tenant_id;
      if (!first) return;
      const c = condominiums.find(x => x.id === first);
      if (!c) return;
      const isOnOwnCondo = condominium?.tenant_id === first;
      if (!condominium || !isOnOwnCondo) {
        setCondominium({
          tenant_id: c.id,
          name: c.name,
          slug: c.slug,
          short_name: c.short_name || c.slug,
          schema_name: c.schema_name,
          image_url: c.image_url
        });
        setCondoSearch(c.name);
      }
    }).catch(() => {});
  }, [isSuperAdmin, user, condominium, condominiums]);

  const filteredUsers = users.filter(u => {
    const q = searchTerm.trim().toLowerCase();
    const email = (u.email || u.users_global?.email || '').toLowerCase();
    const name = (u.name || '').toLowerCase();
    const matchesSearch = !q || email.includes(q) || name.includes(q);
    const matchesRole = !filterRole || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  const { slice: pagedUsers } = paginate(filteredUsers, page, perPage === 'all' ? filteredUsers.length : perPage);

  const handleAddUser = async () => {
    const isGlobalSuper = newUser.role === 'SUPER_ADMIN' && !newUser.tenant_id && isSuperAdmin;
    if (!condominium && !isGlobalSuper) { setError('Seleccione un condominio'); return; }
    setSubmitting(true);
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: { user_id: string; email: string; role: string } | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: {
          tenant_id: newUser.tenant_id || (isGlobalSuper ? '' : condominium?.tenant_id),
          email: newUser.email,
          name: newUser.name,
          role: newUser.role,
          document_type: newUser.document_type,
          document_number: newUser.document_number,
          phone: newUser.phone
        }
      });

      if (fnError) throw fnError;

      if (data?.success) {
        setShowAddForm(false);
        setNewUser({ email: '', name: '', role: 'RESIDENT', tenant_id: '', document_type: 'DNI', document_number: '', phone: '' });
        setAddCondoSearch('');
        if (condominium && newUser.tenant_id && newUser.tenant_id !== condominium.tenant_id) {
          setCondominium({
            tenant_id: newUser.tenant_id,
            name: condominiums.find(c => c.id === newUser.tenant_id)?.name || '',
            slug: condominiums.find(c => c.id === newUser.tenant_id)?.slug || '',
            short_name: condominiums.find(c => c.id === newUser.tenant_id)?.short_name || '',
            schema_name: condominiums.find(c => c.id === newUser.tenant_id)?.schema_name || '',
            image_url: null
          });
        }
        fetchUsers();
      } else {
        setError(data?.error?.message || 'Error al agregar usuario');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (u: TenantUser) => {
    const tenantId = u.tenant_id || condominium?.tenant_id || '';
    const schemaName = condominium?.schema_name || '';
    setEditingUser({ ...u, tenant_id: tenantId, schema_name: schemaName });
    setEditOriginalTenant(tenantId);
    setEditOriginalSchema(schemaName);
    setEditCondoSearch(condominiums.find(c => c.id === tenantId)?.name || '');
    setShowEditForm(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    try {
      const body: Record<string, unknown> = {
        action: 'update',
        id: editingUser.id,
        source: editingUser.source || 'tenant_user',
        name: editingUser.name,
        email: editingUser.email,
        document_type: editingUser.document_type || editingUser.users_global?.document_type || null,
        document_number: editingUser.document_number || editingUser.users_global?.document_number || null,
        phone: editingUser.phone || editingUser.users_global?.phone || null
      };
      if (editingUser.source === 'resident') {
        body.schema_name = editOriginalSchema;
        body.tenant_id = editOriginalTenant;
        if (editingUser.tenant_id) body.new_tenant_id = editingUser.tenant_id;
      } else {
        body.role = editingUser.role;
        body.status = editingUser.status;
        if (editingUser.tenant_id) body.tenant_id = editingUser.tenant_id;
      }

      const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error?.message || 'Error al actualizar usuario');
        return;
      }
      setShowEditForm(false);
      setEditingUser(null);
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  const handleDeleteUser = async (u: TenantUser) => {
    const label = u.name || u.email || u.user_id;
    if (!confirm(`¿Eliminar el usuario "${label}"? Esta acción no se puede deshacer.`)) return;
    try {
      const body: Record<string, unknown> = {
        action: 'delete',
        id: u.id,
        source: u.source || 'tenant_user'
      };
      if (u.source === 'resident') body.schema_name = condominium?.schema_name;

      const { data, error: fnError } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error?.message || 'Error al eliminar usuario');
        return;
      }
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  const handleResetPassword = async (u: TenantUser) => {
    if (!u.user_id) {
      setError('Este residente no tiene cuenta de acceso vinculada.');
      return;
    }
    if (!confirm(`¿Restablecer la contraseña de "${u.name || u.email}" a 12345678?`)) return;
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data?: { default_password?: string; reset?: boolean } | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'reset-password', user_id: u.user_id }
      });

      if (fnError) throw fnError;
      if (!data?.success) {
        setError(data?.error?.message || 'Error al restablecer contraseña');
        return;
      }
      alert(`Contraseña restablecida. Nueva contraseña: ${data.data?.default_password || '12345678'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    }
  };

  useEffect(() => {
    setCondoSearch(condominium?.name || '');
    setCondoDropdownOpen(false);
  }, [condominium]);

  const selectCondo = (c: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null }) => {
    setViewAllCondos(false);
    setCondominium({
      tenant_id: c.id,
      name: c.name,
      slug: c.slug,
      short_name: c.short_name || c.slug,
      schema_name: c.schema_name,
      image_url: c.image_url
    });
    setCondoSearch(c.name);
    setCondoDropdownOpen(false);
  };

  const selectAllCondos = () => {
    setViewAllCondos(true);
    setCondoSearch('');
    setCondoDropdownOpen(false);
  };

  const filteredCondos = condominiums.filter(c => c.name.toLowerCase().includes(condoSearch.trim().toLowerCase()));

  const filteredAddCondos = condominiums.filter(c => c.name.toLowerCase().includes(addCondoSearch.trim().toLowerCase()));

  const selectAddCondo = (c: { id: string; name: string }) => {
    setNewUser(prev => ({ ...prev, tenant_id: c.id }));
    setAddCondoSearch(c.name);
    setAddCondoDropdownOpen(false);
  };

  const filteredEditCondos = condominiums.filter(c => c.name.toLowerCase().includes(editCondoSearch.trim().toLowerCase()));

  const selectEditCondo = (c: { id: string; name: string; schema_name: string }) => {
    setEditingUser(prev => prev ? { ...prev, tenant_id: c.id, schema_name: c.schema_name } : prev);
    setEditCondoSearch(c.name);
    setEditCondoDropdownOpen(false);
  };

  const filteredImportCondos = condominiums.filter(c => c.name.toLowerCase().includes(importCondoSearch.trim().toLowerCase()));

  const selectImportCondo = (c: { id: string; name: string }) => {
    setImportTargetTenant(c.id);
    setImportCondoSearch(c.name);
    setImportCondoDropdownOpen(false);
  };

  const openImportForm = () => {
    const initial = condominium?.tenant_id || '';
    const initialName = condominiums.find(c => c.id === initial)?.name || '';
    setImportTargetTenant(initial);
    setImportCondoSearch(initialName);
    setImportFileName('');
    setImportPreview([]);
    setImportInvalidCount(0);
    setImportResult(null);
    setImportParseError(null);
    setImporting(false);
    if (importFileInputRef.current) importFileInputRef.current.value = '';
    setShowImportForm(true);
  };

  const handleImportFileChange = async (file: File | null) => {
    setImportResult(null);
    setImportParseError(null);
    if (!file) return;
    setImportFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      if (parsed.length < 2) {
        setImportPreview([]);
        setImportInvalidCount(0);
        setImportParseError('El CSV no contiene filas de datos. Asegúrate de incluir una fila de encabezado.');
        return;
      }
      const headers = parsed[0];
      const idx = detectImportColumns(headers);
      if (idx.name === undefined || idx.email === undefined) {
        setImportPreview([]);
        setImportInvalidCount(0);
        setImportParseError('No se encontraron las columnas "Nombre" y "Correo". Verifica la fila de encabezado del CSV.');
        return;
      }
      const { rows, invalid } = mapImportRows(parsed.slice(1), idx);
      setImportPreview(rows);
      setImportInvalidCount(invalid);
    } catch (err) {
      setImportParseError(err instanceof Error ? err.message : 'No se pudo leer el archivo CSV.');
    }
  };

  const handleImportUsers = async () => {
    if (!importTargetTenant) { setImportParseError('Seleccione el condominio de destino'); return; }
    if (importPreview.length === 0) { setImportParseError('No hay filas válidas para importar.'); return; }
    setImporting(true);
    setImportParseError(null);
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: ImportResult | null; error: { message: string } | null }>('list-condominium-users', {
        method: 'POST',
        body: { action: 'import', tenant_id: importTargetTenant, users: importPreview }
      });
      if (fnError) throw fnError;
      if (data?.success && data.data) {
        setImportResult(data.data);
        fetchUsers();
      } else {
        setImportParseError(data?.error?.message || 'Error al importar usuarios');
      }
    } catch (err) {
      setImportParseError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setImporting(false);
    }
  };

  const downloadImportTemplate = () => {
    const content = '\uFEFFNombre,Correo,DNI,Telefono\nJuan Perez,juan.perez@example.com,12345678,+51 999 888 777\nMaria Lopez,maria.lopez@example.com,87654321,+51 987 654 321\n';
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla-usuarios.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (editCondoDropdownRef.current && !editCondoDropdownRef.current.contains(e.target as Node)) {
        setEditCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (condoDropdownRef.current && !condoDropdownRef.current.contains(e.target as Node)) {
        setCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (addCondoDropdownRef.current && !addCondoDropdownRef.current.contains(e.target as Node)) {
        setAddCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (importCondoDropdownRef.current && !importCondoDropdownRef.current.contains(e.target as Node)) {
        setImportCondoDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Usuarios {viewAllCondos ? '- Todos los condominios' : condominium ? `- ${condominium.name}` : ''}</h2>
        <div className="header-actions">
          <button onClick={openImportForm} title="Importar usuarios desde CSV"><span className="material-symbols-outlined">upload_file</span> Importar</button>
          <button onClick={openAddForm}><span className="material-symbols-outlined">person_add</span> Adicionar</button>
        </div>
      </div>
      <div className="condo-search-panel">
        {isSuperAdmin && condominiums.length > 0 && (
          <div className="search-bar condo-picker" ref={condoDropdownRef} style={{ marginBottom: '0.75rem' }}>
            <span className="material-symbols-outlined search-icon">apartment</span>
            <input
              type="text"
              value={condoSearch}
              placeholder="Seleccionar condominio..."
              onFocus={() => setCondoDropdownOpen(true)}
              onChange={(e) => { setCondoSearch(e.target.value); setCondoDropdownOpen(true); }}
              style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}
            />
            {condoDropdownOpen && (
              <div className="condo-picker-dropdown">
                <button type="button" className={`condo-picker-item ${viewAllCondos ? 'selected' : ''}`} onClick={selectAllCondos}>
                  <span className="material-symbols-outlined">public</span>
                  <span>Todos los condominios</span>
                </button>
                {filteredCondos.length === 0 ? (
                  <div className="condo-picker-empty">Sin resultados</div>
                ) : (
                  filteredCondos.map(c => (
                    <button key={c.id} type="button" className={`condo-picker-item ${!viewAllCondos && c.id === condominium?.tenant_id ? 'selected' : ''}`} onClick={() => selectCondo(c)}>
                      <span className="material-symbols-outlined">apartment</span>
                      <span>{c.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
        <div className="search-bar">
          <span className="material-symbols-outlined search-icon">search</span>
          <input type="text" placeholder="Buscar usuario por nombre o correo..." value={searchTerm} onChange={(e) => { setSearchTerm(e.target.value); setPage(1); }} />
          {searchTerm && <button className="clear-search" onClick={() => setSearchTerm('')}><span className="material-symbols-outlined">close</span></button>}
        </div>
        <div className="search-bar" style={{ marginTop: '0.75rem' }}>
          <span className="material-symbols-outlined search-icon">filter_list</span>
          <select value={filterRole} onChange={(e) => { setFilterRole(e.target.value); setPage(1); }} style={{ width: '100%', padding: '0.7rem 0.75rem 0.7rem 2.6rem', border: '1px solid #c6c6cd', borderRadius: '8px', background: '#f8f9ff', color: '#0b1c30' }}>
            <option value="">Todos los roles</option>
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      {showAddForm && (
        <div className="form-modal">
          <h3>Agregar Usuario</h3>
          {isSuperAdmin && (
            <div className="form-group">
              <label>Condominio {newUser.role === 'SUPER_ADMIN' ? '(opcional si es Super Admin global)' : ''}</label>
              <div className="search-bar condo-picker" ref={addCondoDropdownRef}>
                <input
                  type="text"
                  value={addCondoSearch}
                  placeholder={newUser.role === 'SUPER_ADMIN' ? "Buscar condominio o dejar vacío..." : "Buscar condominio..."}
                  style={{ paddingLeft: '0.75rem' }}
                  onFocus={() => setAddCondoDropdownOpen(true)}
                  onChange={(e) => { setAddCondoSearch(e.target.value); setAddCondoDropdownOpen(true); }}
                />
                {addCondoDropdownOpen && (
                  <div className="condo-picker-dropdown">
                    {newUser.role === 'SUPER_ADMIN' && (
                      <button type="button" className={`condo-picker-item ${!newUser.tenant_id ? 'selected' : ''}`} onClick={() => { setNewUser(prev => ({ ...prev, tenant_id: '' })); setAddCondoSearch(''); setAddCondoDropdownOpen(false); }}>
                        <span className="material-symbols-outlined">public</span>
                        <span>Super Admin global (sin condominio)</span>
                      </button>
                    )}
                    {filteredAddCondos.length === 0 ? (
                      <div className="condo-picker-empty">Sin resultados</div>
                    ) : (
                      filteredAddCondos.map(c => (
                        <button key={c.id} type="button" className={`condo-picker-item ${c.id === newUser.tenant_id ? 'selected' : ''}`} onClick={() => selectAddCondo(c)}>
                          <span className="material-symbols-outlined">apartment</span>
                          <span>{c.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="Nombre completo" required />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="correo@ejemplo.com" required />
          </div>
          <div className="form-group">
            <label>Rol</label>
            <select value={newUser.role} onChange={(e) => {
              const role = e.target.value;
              setNewUser({ ...newUser, role });
              if (role === 'SUPER_ADMIN' && isSuperAdmin) { setNewUser(prev => ({ ...prev, role, tenant_id: '' })); setAddCondoSearch(''); }
            }}>
              {Object.entries(ROLE_LABELS).map(([key, label]) => (
                (!isSuperAdmin && key === 'SUPER_ADMIN') ? null : <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Tipo de documento</label>
              <select value={newUser.document_type} onChange={(e) => setNewUser({ ...newUser, document_type: e.target.value })}>
                <option value="DNI">DNI</option>
                <option value="CE">CE</option>
                <option value="PASAPORTE">Pasaporte</option>
              </select>
            </div>
            <div className="form-group">
              <label>Número de documento</label>
              <input type="text" value={newUser.document_number} onChange={(e) => setNewUser({ ...newUser, document_number: e.target.value })} placeholder="12345678" />
            </div>
          </div>
          <div className="form-group">
            <label>Teléfono</label>
            <input type="text" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="+51 999 888 777" />
          </div>
          <small>Se creará una cuenta con contraseña: <code>12345678</code></small>
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowAddForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleAddUser} disabled={submitting}>
              <span className="material-symbols-outlined">person_add</span> {submitting ? 'Creando...' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      {showEditForm && editingUser && (
        <div className="form-modal">
          <h3>Editar Usuario</h3>
          {isSuperAdmin && (
            <div className="form-group">
              <label>Condominio</label>
              <div className="search-bar condo-picker" ref={editCondoDropdownRef}>
                <span className="material-symbols-outlined search-icon">apartment</span>
                <input
                  type="text"
                  value={editCondoSearch}
                  placeholder="Buscar condominio..."
                  onFocus={() => setEditCondoDropdownOpen(true)}
                  onChange={(e) => { setEditCondoSearch(e.target.value); setEditCondoDropdownOpen(true); }}
                />
                {editCondoDropdownOpen && (
                  <div className="condo-picker-dropdown">
                    {filteredEditCondos.length === 0 ? (
                      <div className="condo-picker-empty">Sin resultados</div>
                    ) : (
                      filteredEditCondos.map(c => (
                        <button key={c.id} type="button" className={`condo-picker-item ${c.id === editingUser.tenant_id ? 'selected' : ''}`} onClick={() => selectEditCondo(c)}>
                          <span className="material-symbols-outlined">apartment</span>
                          <span>{c.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Nombre</label>
            <input type="text" value={editingUser.name || ''} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Tipo de documento</label>
              <select value={editingUser.document_type || editingUser.users_global?.document_type || 'DNI'} onChange={(e) => setEditingUser({ ...editingUser, document_type: e.target.value })}>
                <option value="DNI">DNI</option>
                <option value="CE">CE</option>
                <option value="PASAPORTE">Pasaporte</option>
              </select>
            </div>
            <div className="form-group">
              <label>Número de documento</label>
              <input type="text" value={editingUser.document_number || editingUser.users_global?.document_number || ''} onChange={(e) => setEditingUser({ ...editingUser, document_number: e.target.value })} placeholder="12345678" />
            </div>
          </div>
          <div className="form-group">
            <label>Teléfono</label>
            <input type="text" value={editingUser.phone || editingUser.users_global?.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })} placeholder="+51 999 888 777" />
          </div>
          <div className="form-group">
            <label>Fecha de registro</label>
            <input type="text" value={editingUser.created_at ? new Date(editingUser.created_at).toLocaleDateString('es-PE') : '-'} readOnly />
          </div>
          {editingUser.source !== 'resident' && (
            <>
              <div className="form-group">
                <label>Rol</label>
                <select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}>
                  {Object.entries(ROLE_LABELS).map(([key, label]) => (
                    (!isSuperAdmin && key === 'SUPER_ADMIN') ? null : <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Estado</label>
                <select value={editingUser.status} onChange={(e) => setEditingUser({ ...editingUser, status: e.target.value })}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="PENDING">PENDING</option>
                </select>
              </div>
            </>
          )}
          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowEditForm(false)}><span className="material-symbols-outlined">close</span> Cancelar</button>
            <button onClick={handleSaveEdit}><span className="material-symbols-outlined">save</span> Guardar</button>
          </div>
        </div>
      )}

      {showImportForm && (
        <div className="form-modal">
          <h3>Importar Usuarios desde CSV</h3>
          {isSuperAdmin && (
            <div className="form-group">
              <label>Condominio de destino</label>
              <div className="search-bar condo-picker" ref={importCondoDropdownRef}>
                <input
                  type="text"
                  value={importCondoSearch}
                  placeholder="Buscar condominio..."
                  style={{ paddingLeft: '0.75rem' }}
                  onFocus={() => setImportCondoDropdownOpen(true)}
                  onChange={(e) => { setImportCondoSearch(e.target.value); setImportCondoDropdownOpen(true); }}
                />
                {importCondoDropdownOpen && (
                  <div className="condo-picker-dropdown">
                    {filteredImportCondos.length === 0 ? (
                      <div className="condo-picker-empty">Sin resultados</div>
                    ) : (
                      filteredImportCondos.map(c => (
                        <button key={c.id} type="button" className={`condo-picker-item ${c.id === importTargetTenant ? 'selected' : ''}`} onClick={() => selectImportCondo(c)}>
                          <span className="material-symbols-outlined">apartment</span>
                          <span>{c.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="form-group">
            <label>Archivo CSV</label>
            <input
              ref={importFileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleImportFileChange(e.target.files?.[0] || null)}
            />
            <small style={{ display: 'block', marginTop: '0.4rem' }}>
              Columnas aceptadas: <code>Nombre, Correo, DNI, Telefono</code>. La primera fila debe ser el encabezado.
              <br />
              <button type="button" className="btn-cancel" style={{ display: 'inline-flex', gap: '0.3rem', marginTop: '0.4rem' }} onClick={downloadImportTemplate}>
                <span className="material-symbols-outlined">download</span> Descargar plantilla
              </button>
            </small>
          </div>

          {importFileName && (
            <div className="import-summary">
              <span className="material-symbols-outlined">description</span>
              <span><strong>{importFileName}</strong> — {importPreview.length} fila(s) válida(s){importInvalidCount > 0 ? `, ${importInvalidCount} omitida(s)` : ''}</span>
            </div>
          )}

          {importPreview.length > 0 && (
            <div className="import-preview">
              <table>
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>DNI</th>
                    <th>Teléfono</th>
                  </tr>
                </thead>
                <tbody>
                  {importPreview.slice(0, 5).map((r, i) => (
                    <tr key={i}>
                      <td>{r.name}</td>
                      <td className="users-email-cell">{r.email}</td>
                      <td>{r.document_number || '-'}</td>
                      <td>{r.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {importPreview.length > 5 && <div className="import-preview-more">… y {importPreview.length - 5} más</div>}
            </div>
          )}

          {importParseError && <div className="error-message">{importParseError}</div>}

          {importResult && (
            <div className="import-result">
              <div className="import-result-summary">
                <div className="import-result-count"><span className="material-symbols-outlined">check_circle</span><span><strong>{importResult.created}</strong> importado(s)</span></div>
                <div className="import-result-count"><span className="material-symbols-outlined">skip_next</span><span><strong>{importResult.skipped}</strong> omitido(s) (ya existían)</span></div>
                <div className="import-result-count"><span className="material-symbols-outlined">error</span><span><strong>{importResult.failed}</strong> con error</span></div>
              </div>
              {importResult.errors.length > 0 && (
                <ul className="import-result-errors">
                  {importResult.errors.slice(0, 10).map((e, i) => (
                    <li key={i}>{e.email}: {e.reason}</li>
                  ))}
                  {importResult.errors.length > 10 && <li>… y {importResult.errors.length - 10} más</li>}
                </ul>
              )}
              <small>La contraseña de todos los usuarios importados es: <code>12345678</code></small>
            </div>
          )}

          <div className="form-actions">
            <button className="btn-cancel" onClick={() => setShowImportForm(false)}><span className="material-symbols-outlined">close</span> Cerrar</button>
            <button onClick={handleImportUsers} disabled={importing || importPreview.length === 0}>
              <span className="material-symbols-outlined">upload_file</span> {importing ? 'Importando...' : 'Importar'}
            </button>
          </div>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      {loading ? (
        <div className="loading-message">Cargando usuarios...</div>
      ) : filteredUsers.length === 0 ? (
        <div className="empty-state"><p>No hay usuarios registrados en este condominio.</p></div>
      ) : (
        <div className="users-table-wrap">
          <div className="users-card-grid">
            {pagedUsers.map(u => (
              <div key={`${u.id}-${u.user_id}`} className="user-card">
                <div className="user-card-avatar">
                  <span className="material-symbols-outlined">person</span>
                </div>
                <div className="user-card-info">
                  <div className="user-card-line"><span className="user-card-label">Nombre</span><span>{u.name || '-'}</span></div>
                  <div className="user-card-line"><span className="user-card-label">Correo</span><span>{u.email || u.users_global?.email || '-'}</span></div>
                  {viewAllCondos && <div className="user-card-line"><span className="user-card-label">Condominio</span><span>{u.tenant_name || '-'}</span></div>}
                  {(u.document_type || u.document_number) && <div className="user-card-line"><span className="user-card-label">Documento</span><span>{u.document_type || ''} {u.document_number || ''}</span></div>}
                  {u.phone && <div className="user-card-line"><span className="user-card-label">Teléfono</span><span>{u.phone}</span></div>}
                  <div className="user-card-line"><span className="user-card-label">Rol</span><span>{ROLE_LABELS[u.role] || u.role}</span></div>
                  <div className="user-card-line"><span className="user-card-label">Estado</span><span className={`status-badge ${u.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{u.status}</span></div>
                </div>
                <div className="user-card-actions">
                  <button className="icon-btn" onClick={() => startEdit(u)} title="Editar usuario">
                    <span className="material-symbols-outlined">edit</span>
                  </button>
                  <button className="icon-btn" onClick={() => handleResetPassword(u)} title="Restablecer contraseña (12345678)">
                    <span className="material-symbols-outlined">key</span>
                  </button>
                  <button className="icon-btn danger" onClick={() => handleDeleteUser(u)} title="Eliminar usuario">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <table>
            <thead>
              <tr>
                {viewAllCondos && <th>Condominio</th>}
                <th>Nombre</th>
                <th className="users-email-cell">Email</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pagedUsers.map(u => (
                <tr key={`${u.id}-${u.user_id}`}>
                  {viewAllCondos && <td>{u.tenant_name || '-'}</td>}
                  <td>{u.name || '-'}</td>
                  <td className="users-email-cell">{u.email || u.users_global?.email || '-'}</td>
                  <td>{ROLE_LABELS[u.role] || u.role}</td>
                  <td><span className={`status-badge ${u.status === 'ACTIVE' ? 'status-occupied' : 'status-vacant'}`}>{u.status}</span></td>
                  <td>
                    <div className="condo-card-actions" style={{ marginTop: 0, paddingTop: 0, borderTop: 'none', justifyContent: 'flex-start' }}>
                      <button className="icon-btn" onClick={() => startEdit(u)} title="Editar usuario">
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <button className="icon-btn" onClick={() => handleResetPassword(u)} title="Restablecer contraseña (12345678)">
                        <span className="material-symbols-outlined">key</span>
                      </button>
                      <button className="icon-btn danger" onClick={() => handleDeleteUser(u)} title="Eliminar usuario">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <PaginationBar
            total={filteredUsers.length}
            page={page}
            perPage={perPage}
            onPageChange={setPage}
            onPerPageChange={(n) => setPerPage(n)}
            itemLabel="usuario"
          />
        </div>
      )}
    </div>
  );
}