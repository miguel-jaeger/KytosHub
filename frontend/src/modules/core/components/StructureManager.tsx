import { useRef, useState } from 'react';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { invokeFunction } from '../../../lib/insforge';
import { useTowerStructure } from '../hooks/useTowerStructure';
import { TowerWizard } from './TowerWizard';
import { DepartmentModal } from './DepartmentModal';
import { PaginationBar, paginate } from '../../../components/Pagination';
import { useUserRole } from '../../../hooks/useUserRole';
import type { ApiResponse, Resident, TowerNode, DepartmentNode } from '../types';

interface ResidentImportCandidate extends Omit<Partial<Resident>, 'id'> {
  id: string | null;
  user_id?: string | null;
  full_name: string;
  document_number: string;
  department_id?: string;
}

interface ResidentImportRow {
  line: number;
  towerCode: string;
  departmentNumber: string;
  floorNumber?: number;
  documentNumber: string;
  departmentId?: string;
  resident?: ResidentImportCandidate;
  error?: string;
}

function parseResidentCsv(text: string): string[][] {
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
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

function normalizeDni(value: string): string {
  return value.replace(/\D/g, '');
}

export function StructureManager() {
  const { condominium } = useCondominium();
  const role = useUserRole();
  const { towers, loading, error, refresh } = useTowerStructure();
  const [expandedTower, setExpandedTower] = useState<string | null>(null);
  const [expandedFloor, setExpandedFloor] = useState<string | null>(null);
  const [showTowerForm, setShowTowerForm] = useState(false);
  const [selectedDept, setSelectedDept] = useState<{ tower: TowerNode; floor: { id: string; floor_number: number }; dept: DepartmentNode } | null>(null);
  const [floorForm, setFloorForm] = useState<{ towerId: string; open: boolean; floorNumber: string }>({ towerId: '', open: false, floorNumber: '' });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [towerPage, setTowerPage] = useState(1);
  const [towerPerPage, setTowerPerPage] = useState<number | 'all'>(10);
  const [showResidentImport, setShowResidentImport] = useState(false);
  const [residentImportFile, setResidentImportFile] = useState('');
  const [residentImportRows, setResidentImportRows] = useState<ResidentImportRow[]>([]);
  const [residentImportError, setResidentImportError] = useState<string | null>(null);
  const [validatingResidentImport, setValidatingResidentImport] = useState(false);
  const [importingResidents, setImportingResidents] = useState(false);
  const [residentImportProgress, setResidentImportProgress] = useState<{ current: number; total: number } | null>(null);
  const [residentImportSummary, setResidentImportSummary] = useState<{ added: number; errors: string[] } | null>(null);
  const residentImportInputRef = useRef<HTMLInputElement>(null);

  const { slice: pagedTowers } = paginate(towers, towerPage, towerPerPage === 'all' ? towers.length : towerPerPage);

  const schemaName = condominium?.schema_name;
  const isSuperAdmin = role === 'super';

  const doAction = async (fn: string, body: Record<string, unknown>) => {
    const { data, error } = await invokeFunction<{ success: boolean; error?: { message?: string } }>(fn, { method: 'POST', body });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error');
  };

  const handleDeleteTower = async (id: string) => {
    if (!confirm('¿Eliminar esta torre y todos sus pisos, departamentos y residentes?')) return;
    try { await doAction('towers', { action: 'delete', id, schema_name: schemaName }); await refresh(); setStatusMsg('Torre eliminada'); }
    catch (e) { alert((e as Error).message); }
  };

  const handleAddFloor = async () => {
    if (!schemaName) return;
    const num = parseInt(floorForm.floorNumber, 10);
    if (isNaN(num) || num <= 0) return;
    try { await doAction('floors', { action: 'create', tower_id: floorForm.towerId, floor_number: num, schema_name: schemaName }); await refresh(); setFloorForm({ towerId: '', open: false, floorNumber: '' }); setStatusMsg('Piso agregado'); }
    catch (e) { alert((e as Error).message); }
  };

  const handleDeleteFloor = async (id: string) => {
    if (!confirm('¿Eliminar este piso con sus departamentos y residentes?')) return;
    try { await doAction('floors', { action: 'delete', id, schema_name: schemaName }); await refresh(); setStatusMsg('Piso eliminado'); }
    catch (e) { alert((e as Error).message); }
  };

  const handleDeleteDept = async (id: string) => {
    if (!confirm('¿Eliminar este departamento y sus residentes?')) return;
    try { await doAction('departments', { action: 'delete', id, schema_name: schemaName }); await refresh(); setStatusMsg('Departamento eliminado'); }
    catch (e) { alert((e as Error).message); }
  };

  const handleChangeDeptStatus = async (dept: DepartmentNode, status: string) => {
    try { await doAction('departments', { action: 'update', id: dept.id, status, schema_name: schemaName }); await refresh(); }
    catch (e) { alert((e as Error).message); }
  };

  const openResidentImport = () => {
    setResidentImportFile('');
    setResidentImportRows([]);
    setResidentImportError(null);
    setResidentImportSummary(null);
    setResidentImportProgress(null);
    if (residentImportInputRef.current) residentImportInputRef.current.value = '';
    setShowResidentImport(true);
  };

  const downloadResidentTemplate = () => {
    const link = document.createElement('a');
    link.href = '/plantilla-residente.csv';
    link.download = 'plantilla-residente.csv';
    link.click();
  };

  const handleResidentImportFile = async (file: File | null) => {
    setResidentImportError(null);
    setResidentImportSummary(null);
    setResidentImportRows([]);
    if (!file) return;
    setResidentImportFile(file.name);
    setValidatingResidentImport(true);
    try {
      const csvRows = parseResidentCsv(await file.text());
      if (csvRows.length < 2) throw new Error('El CSV debe incluir encabezados y al menos una fila de datos.');

      const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const indexes: { tower?: number; department?: number; dni?: number } = {};
      csvRows[0].forEach((header, index) => {
        const key = normalizeHeader(header);
        if (['torre', 'codigo de torre', 'codigo corto'].includes(key)) indexes.tower = index;
        else if (['departamento', 'dpto', 'depto', 'numero de departamento'].includes(key)) indexes.department = index;
        else if (['dni', 'documento', 'numero de dni'].includes(key)) indexes.dni = index;
      });
      if (indexes.tower === undefined || indexes.department === undefined || indexes.dni === undefined) {
        throw new Error('No se encontraron las columnas Torre, Departamento y DNI.');
      }

      const parsedRows: ResidentImportRow[] = csvRows.slice(1).map((cells, index) => {
        const valueAt = (column?: number) => column === undefined ? '' : (cells[column] || '').trim();
        const towerCode = valueAt(indexes.tower);
        const departmentNumber = valueAt(indexes.department).replace(/\s/g, '');
        const documentNumber = normalizeDni(valueAt(indexes.dni));
        const entry: ResidentImportRow = { line: index + 2, towerCode, departmentNumber, documentNumber };
        if (!towerCode || !departmentNumber || !documentNumber) {
          entry.error = 'Falta el código corto de torre, el departamento o el DNI.';
          return entry;
        }
        if (!/^\d{8}$/.test(documentNumber)) {
          entry.error = 'El DNI debe contener 8 cifras.';
          return entry;
        }
        if (!/^\d{3,}$/.test(departmentNumber)) {
          entry.error = 'El departamento debe ser un número de al menos 3 cifras.';
          return entry;
        }

        const towerMatches = towers.filter(t => t.code.trim().toLowerCase() === towerCode.toLowerCase());
        if (towerMatches.length !== 1) {
          entry.error = towerMatches.length === 0 ? `No existe una torre con nombre corto ${towerCode}.` : `El nombre corto ${towerCode} identifica más de una torre.`;
          return entry;
        }

        const floorNumber = Number(departmentNumber.slice(0, -2));
        if (!Number.isInteger(floorNumber) || floorNumber < 1) {
          entry.error = `No se pudo obtener el piso desde el departamento ${departmentNumber}.`;
          return entry;
        }
        entry.floorNumber = floorNumber;
        const floor = towerMatches[0].floors.find(f => f.floor_number === floorNumber);
        if (!floor) {
          entry.error = `La torre ${towerCode} no tiene el piso ${floorNumber}.`;
          return entry;
        }

        const exactDepartments = floor.departments.filter(d => d.department_number.trim() === departmentNumber);
        const numberDepartments = floor.departments.filter(d => /^\d+$/.test(d.department_number) && Number(d.department_number) === Number(departmentNumber));
        const departmentMatches = exactDepartments.length > 0 ? exactDepartments : numberDepartments;
        if (departmentMatches.length !== 1) {
          entry.error = departmentMatches.length === 0
            ? `No existe el departamento ${departmentNumber} en el piso ${floorNumber} de la torre ${towerCode}.`
            : `El número ${departmentNumber} identifica más de un departamento en la torre ${towerCode}.`;
          return entry;
        }
        entry.departmentId = departmentMatches[0].id;
        return entry;
      });

      const seenAssignments = new Set<string>();
      for (const row of parsedRows) {
        if (row.error || !row.departmentId) continue;
        const key = `${row.departmentId}:${row.documentNumber}`;
        if (seenAssignments.has(key)) row.error = `El DNI ${row.documentNumber} está repetido para este departamento en el archivo.`;
        else seenAssignments.add(key);
      }

      const rowsToResolve = parsedRows.filter(row => !row.error && row.departmentId);
      if (rowsToResolve.length > 0) {
        if (!schemaName) throw new Error('No hay un condominio activo.');
        const { data, error: functionError } = await invokeFunction<ApiResponse<ResidentImportCandidate[]>>('residents', {
          method: 'POST',
          body: {
            action: 'list',
            schema_name: schemaName,
            include_users: true,
            tenant_id: condominium?.tenant_id,
            all_users: isSuperAdmin
          }
        });
        if (functionError) throw functionError;
        if (!data?.success || !data.data) throw new Error(data?.error?.message || 'No se pudieron buscar residentes por DNI.');
        const candidates = data.data;

        for (const row of rowsToResolve) {
          const matches = candidates.filter(candidate =>
            candidate.document_type !== 'CE' && candidate.document_type !== 'PASAPORTE' && candidate.document_type !== 'RUC' &&
            normalizeDni(candidate.document_number || '') === row.documentNumber
          );
          if (matches.some(candidate => candidate.department_id === row.departmentId)) {
            row.error = `El DNI ${row.documentNumber} ya está asignado a este departamento.`;
            continue;
          }
          const identities = new Set(matches.map(candidate => candidate.user_id ? `user:${candidate.user_id}` : `resident:${candidate.id}`));
          if (identities.size > 1) {
            row.error = `Hay más de un residente con DNI ${row.documentNumber}; no se puede determinar a quién asignar.`;
            continue;
          }
          if (matches.length === 0) {
            row.error = `No se encontró un residente existente con DNI ${row.documentNumber}.`;
            continue;
          }
          row.resident = matches.find(candidate => candidate.id) || matches[0];
        }
      }
      setResidentImportRows(parsedRows);
    } catch (err) {
      setResidentImportError(err instanceof Error ? err.message : 'No se pudo leer o validar el CSV.');
    } finally {
      setValidatingResidentImport(false);
    }
  };

  const handleImportResidents = async () => {
    const readyRows = residentImportRows.filter(row => !row.error && row.resident && row.departmentId);
    if (readyRows.length === 0) {
      setResidentImportError('No hay filas válidas para importar.');
      return;
    }
    if (!schemaName) {
      setResidentImportError('No hay un condominio activo.');
      return;
    }

    setImportingResidents(true);
    setResidentImportError(null);
    setResidentImportSummary(null);
    let added = 0;
    const resultErrors = residentImportRows.filter(row => row.error).map(row => `Fila ${row.line}: ${row.error}`);
    try {
      for (let i = 0; i < readyRows.length; i++) {
        const row = readyRows[i];
        const resident = row.resident!;
        setResidentImportProgress({ current: i + 1, total: readyRows.length });
        try {
          const isGlobalUser = !resident.id && Boolean(resident.user_id);
          const { data, error: functionError } = await invokeFunction<ApiResponse<Resident | null>>('residents', {
            method: 'POST',
            body: isGlobalUser ? {
              action: 'link-user',
              schema_name: schemaName,
              user_id: resident.user_id,
              department_id: row.departmentId,
              document_type: resident.document_type || 'DNI',
              document_number: resident.document_number || row.documentNumber,
              relationship_type: 'PROPIETARIO'
            } : {
              action: 'create',
              schema_name: schemaName,
              department_id: row.departmentId,
              full_name: resident.full_name,
              document_type: resident.document_type || 'DNI',
              document_number: resident.document_number || row.documentNumber,
              relationship_type: resident.relationship_type || 'PROPIETARIO',
              is_primary_contact: resident.is_primary_contact || false,
              email: resident.email || null,
              phone: resident.phone || null
            }
          });
          if (functionError) throw functionError;
          if (!data?.success || !data.data) throw new Error(data?.error?.message || 'El residente ya está asignado o no se pudo agregar.');
          added++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Error al agregar residente';
          resultErrors.push(`Fila ${row.line} (DNI ${row.documentNumber}): ${message}`);
        }
      }
      setResidentImportSummary({ added, errors: resultErrors });
      setResidentImportRows(current => current.map(row => {
        const failed = resultErrors.find(message => message.startsWith(`Fila ${row.line} `));
        return failed && !row.error ? { ...row, error: failed.slice(failed.indexOf(': ') + 2) } : row;
      }));
      await refresh();
    } finally {
      setImportingResidents(false);
      setResidentImportProgress(null);
    }
  };

  if (loading) return <div className="loading-message">Cargando estructura...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="structure-manager">
      {statusMsg && (
        <div className="success-message" onClick={() => setStatusMsg(null)}>
          {statusMsg} — clic para cerrar
        </div>
      )}

      <div className="header">
        <h2>Estructura del Condominio</h2>
        <div className="header-actions structure-header-actions">
          <button onClick={openResidentImport} disabled={!schemaName || role === 'loading'}>
            <span className="material-symbols-outlined">upload_file</span> Importar residentes
          </button>
          <button onClick={() => { setShowTowerForm(!showTowerForm); setExpandedTower(null); }}>
            <span className="material-symbols-outlined">add_business</span> Adicionar torre
          </button>
        </div>
      </div>

      {showTowerForm && (
        <div className="modal-overlay" onClick={() => setShowTowerForm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <TowerWizard onComplete={() => { setShowTowerForm(false); refresh(); }} onCancel={() => setShowTowerForm(false)} />
          </div>
        </div>
      )}

      {showResidentImport && (
        <div className="modal-overlay" onClick={() => !importingResidents && !validatingResidentImport && setShowResidentImport(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Importar residentes por departamento</h3>
                <p className="text-on-surface-variant">La torre se identifica por su código corto. El piso se obtiene de las cifras anteriores a los últimos dos dígitos del departamento.</p>
              </div>
              <button className="modal-close" onClick={() => !importingResidents && !validatingResidentImport && setShowResidentImport(false)} title="Cerrar" disabled={importingResidents || validatingResidentImport}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Archivo CSV</label>
                <input
                  ref={residentImportInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={validatingResidentImport || importingResidents}
                  onChange={e => void handleResidentImportFile(e.target.files?.[0] || null)}
                />
                <small>Columnas requeridas: Torre, Departamento y DNI. Ejemplo: torre T1, departamento 1205 → piso 12, departamento 1205. Si la cuenta aún no tiene ficha local, se vinculará como Propietario.</small>
                <button type="button" className="btn-cancel" style={{ display: 'inline-flex', gap: '0.3rem', marginTop: '0.5rem' }} onClick={downloadResidentTemplate}>
                  <span className="material-symbols-outlined">download</span> Descargar plantilla
                </button>
              </div>

              {residentImportFile && (
                <div className="import-summary">
                  <span className="material-symbols-outlined">description</span>
                  <span><strong>{residentImportFile}</strong> — {residentImportRows.filter(row => !row.error && row.resident).length} válida(s), {residentImportRows.filter(row => row.error).length} omitida(s)</span>
                </div>
              )}

              {(validatingResidentImport || importingResidents) && (
                <div className="import-loader">
                  <div className="import-loader-spinner" aria-hidden="true" />
                  <div className="import-loader-text">
                    <strong>{validatingResidentImport ? 'Validando archivo y buscando DNI...' : 'Asignando residentes...'}</strong>
                    {residentImportProgress && <span>{residentImportProgress.current} de {residentImportProgress.total} fila(s)</span>}
                  </div>
                </div>
              )}

              {residentImportError && <div className="error-message">{residentImportError}</div>}

              {residentImportRows.some(row => row.error) && (
                <div className="import-invalid-details">
                  <div className="import-invalid-title">
                    <span className="material-symbols-outlined">warning</span>
                    <strong>Filas que no se importarán ({residentImportRows.filter(row => row.error).length})</strong>
                  </div>
                  <ul>
                    {residentImportRows.filter(row => row.error).slice(0, 20).map(row => (
                      <li key={row.line}><code>Fila {row.line}</code><span className="import-invalid-email">DNI {row.documentNumber || '(vacío)'}</span><span>— {row.error}</span></li>
                    ))}
                    {residentImportRows.filter(row => row.error).length > 20 && <li>… y {residentImportRows.filter(row => row.error).length - 20} más</li>}
                  </ul>
                </div>
              )}

              {residentImportRows.some(row => !row.error && row.resident) && (
                <div className="import-preview">
                  <table>
                    <thead><tr><th>Fila</th><th>Torre</th><th>Piso</th><th>Departamento</th><th>DNI</th><th>Residente encontrado</th></tr></thead>
                    <tbody>
                      {residentImportRows.filter(row => !row.error && row.resident).slice(0, 10).map(row => (
                        <tr key={row.line}>
                          <td>{row.line}</td><td>{row.towerCode}</td><td>{row.floorNumber}</td><td>{row.departmentNumber}</td><td>{row.documentNumber}</td><td>{row.resident?.full_name}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {residentImportRows.filter(row => !row.error && row.resident).length > 10 && <div className="import-preview-more">… y {residentImportRows.filter(row => !row.error && row.resident).length - 10} más</div>}
                </div>
              )}

              {residentImportSummary && (
                <div className="import-result">
                  <div className="import-result-summary">
                    <div className="import-result-count"><span className="material-symbols-outlined">check_circle</span><span><strong>{residentImportSummary.added}</strong> residente(s) asignado(s)</span></div>
                    {residentImportSummary.errors.length > 0 && <div className="import-result-count"><span className="material-symbols-outlined">error</span><span><strong>{residentImportSummary.errors.length}</strong> fila(s) omitida(s) o con error</span></div>}
                  </div>
                  {residentImportSummary.errors.length > 0 && <ul className="import-result-errors">{residentImportSummary.errors.slice(0, 20).map((item, index) => <li key={index}>{item}</li>)}</ul>}
                </div>
              )}

              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowResidentImport(false)} disabled={importingResidents || validatingResidentImport}>Cerrar</button>
                <button
                  onClick={() => void handleImportResidents()}
                  disabled={validatingResidentImport || importingResidents || Boolean(residentImportSummary) || !residentImportRows.some(row => !row.error && row.resident)}
                >
                  <span className="material-symbols-outlined">upload_file</span>
                  {importingResidents ? 'Importando...' : 'Importar residentes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {floorForm.open && (
        <div className="modal-overlay" onClick={() => setFloorForm({ towerId: '', open: false, floorNumber: '' })}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Agregar piso</h3>
                <p className="text-on-surface-variant">Indica el número del nuevo piso de la torre.</p>
              </div>
              <button className="modal-close" onClick={() => setFloorForm({ towerId: '', open: false, floorNumber: '' })} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Número de piso</label>
                <input type="number" min={1} value={floorForm.floorNumber} onChange={e => setFloorForm({ ...floorForm, floorNumber: e.target.value })} placeholder="N° piso" autoFocus />
              </div>
              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setFloorForm({ towerId: '', open: false, floorNumber: '' })}>Cancelar</button>
                <button onClick={handleAddFloor}><span className="material-symbols-outlined">check</span> Adicionar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {towers.length === 0 ? (
        <div className="empty-state">
          <p>No hay torres registradas.</p>
          <button onClick={() => setShowTowerForm(true)}><span className="material-symbols-outlined">add_business</span> Adicionar</button>
        </div>
      ) : (
        <>
          <div className={`tower-list ${expandedTower ? 'tower-list-expanded' : ''}`}>
            {pagedTowers.map(tower => (
              <div key={tower.id} className={`tower-card ${expandedTower === tower.id ? 'tower-card-expanded' : expandedTower ? 'tower-card-hidden' : ''}`}>
              <div className="tower-header" onClick={() => setExpandedTower(expandedTower === tower.id ? null : tower.id)}>
                <span className="tower-icon">{expandedTower === tower.id ? '▼' : '▶'}</span>
                <div className="tower-info">
                  <h3>{tower.name}</h3>
                  <span className="tower-code">Código: {tower.code}</span>
                </div>
                <div className="tower-stats">
                  <span>{tower.floors.length} pisos</span>
                  <span>{tower.floors.reduce((s, f) => s + f.departments.length, 0)} deptos</span>
                </div>
                <div className="tower-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn danger" onClick={() => handleDeleteTower(tower.id)} title="Eliminar torre">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>

              {expandedTower === tower.id && (
                <div className="tower-floors">
                  <div className="tower-toolbar">
                    <span className="toolbar-title">Pisos</span>
                    <button onClick={() => setFloorForm({ towerId: tower.id, open: true, floorNumber: String(tower.floors.length + 1) })}>
                      <span className="material-symbols-outlined">add</span> Piso
                    </button>
                  </div>

                  {tower.floors.map(floor => (
                    <div key={floor.id} className="floor-card">
                      <div className="floor-header" onClick={() => setExpandedFloor(expandedFloor === floor.id ? null : floor.id)}>
                        <span className="floor-icon">{expandedFloor === floor.id ? '▼' : '▶'}</span>
                        <span className="floor-label">Piso {floor.floor_number}</span>
                        <span className="floor-count">{floor.departments.length} deptos</span>
                        <div className="floor-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="icon-btn danger" onClick={() => handleDeleteFloor(floor.id)} title="Eliminar piso">
                            <span className="material-symbols-outlined">delete</span>
                          </button>
                        </div>
                      </div>

                      {expandedFloor === floor.id && (
                        <div className="department-grid">
                          {floor.departments.map(dept => (
                            <div key={dept.id} className="department-card clickable" onClick={() => setSelectedDept({ tower, floor, dept })}>
                              <span className="department-number">Dpto {dept.department_number}</span>
                              <span className={`status-badge ${dept.status.toLowerCase()}`}>{dept.status}</span>
                              <span className="dept-residents">{dept.residents_count ?? 0} residentes</span>
                              <div className="department-actions" onClick={(e) => e.stopPropagation()}>
                                <select value={dept.status} onChange={e => handleChangeDeptStatus(dept, e.target.value)}>
                                  <option value="HABITADO">Habitado</option>
                                  <option value="DESOCUPADO">Desocupado</option>
                                  <option value="MANTENIMIENTO">Mantenimiento</option>
                                </select>
                                <button className="icon-btn" onClick={() => setSelectedDept({ tower, floor, dept })} title="Editar / Residentes">
                                  <span className="material-symbols-outlined">group</span>
                                </button>
                                <button className="icon-btn danger" onClick={() => handleDeleteDept(dept.id)} title="Eliminar departamento">
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
          <PaginationBar
            total={towers.length}
            page={towerPage}
            perPage={towerPerPage}
            onPageChange={setTowerPage}
            onPerPageChange={(n) => setTowerPerPage(n)}
            itemLabel="torre"
          />
        </>
      )}

      {selectedDept && (
        <DepartmentModal
          towerName={selectedDept.tower.name}
          towerCode={selectedDept.tower.code}
          floorNumber={selectedDept.floor.floor_number}
          department={selectedDept.dept}
          departmentId={selectedDept.dept.id}
          onClose={() => { setSelectedDept(null); refresh(); }}
          onResidentChange={() => refresh()}
        />
      )}
    </div>
  );
}
