import { useState } from 'react';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { invokeFunction } from '../../../lib/insforge';
import { useTowerStructure } from '../hooks/useTowerStructure';
import { TowerWizard } from './TowerWizard';
import { DepartmentModal } from './DepartmentModal';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { TowerNode, DepartmentNode } from '../types';

export function StructureManager() {
  const { condominium } = useCondominium();
  const { towers, loading, error, refresh } = useTowerStructure();
  const [expandedTower, setExpandedTower] = useState<string | null>(null);
  const [expandedFloor, setExpandedFloor] = useState<string | null>(null);
  const [showTowerForm, setShowTowerForm] = useState(false);
  const [selectedDept, setSelectedDept] = useState<{ tower: TowerNode; floor: { id: string; floor_number: number }; dept: DepartmentNode } | null>(null);
  const [floorForm, setFloorForm] = useState<{ towerId: string; open: boolean; floorNumber: string }>({ towerId: '', open: false, floorNumber: '' });
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [towerPage, setTowerPage] = useState(1);
  const [towerPerPage, setTowerPerPage] = useState<number | 'all'>(10);

  const { slice: pagedTowers } = paginate(towers, towerPage, towerPerPage === 'all' ? towers.length : towerPerPage);

  const schemaName = condominium?.schema_name;

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
        <button onClick={() => { setShowTowerForm(!showTowerForm); setExpandedTower(null); }}>
          <span className="material-symbols-outlined">add_business</span> Adicionar
        </button>
      </div>

      {showTowerForm && (
        <div className="tower-form-section">
          <TowerWizard onComplete={() => { setShowTowerForm(false); refresh(); }} />
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
                  <button className="btn-danger" onClick={() => handleDeleteTower(tower.id)} title="Eliminar torre">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                </div>
              </div>

              {expandedTower === tower.id && (
                <div className="tower-floors">
                  <div className="tower-toolbar">
                    <span className="toolbar-title">Pisos</span>
                    {floorForm.open && floorForm.towerId === tower.id ? (
                      <div className="inline-add">
                        <input type="number" value={floorForm.floorNumber} onChange={e => setFloorForm({ ...floorForm, floorNumber: e.target.value })} placeholder="N° piso" />
                        <button onClick={handleAddFloor}><span className="material-symbols-outlined">check</span> Adicionar</button>
                        <button onClick={() => setFloorForm({ towerId: '', open: false, floorNumber: '' })}><span className="material-symbols-outlined">close</span></button>
                      </div>
                    ) : (
                      <button onClick={() => setFloorForm({ towerId: tower.id, open: true, floorNumber: String(tower.floors.length + 1) })}>
                        <span className="material-symbols-outlined">add</span> Piso
                      </button>
                    )}
                  </div>

                  {tower.floors.map(floor => (
                    <div key={floor.id} className="floor-card">
                      <div className="floor-header" onClick={() => setExpandedFloor(expandedFloor === floor.id ? null : floor.id)}>
                        <span className="floor-icon">{expandedFloor === floor.id ? '▼' : '▶'}</span>
                        <span className="floor-label">Piso {floor.floor_number}</span>
                        <span className="floor-count">{floor.departments.length} deptos</span>
                        <div className="floor-actions" onClick={(e) => e.stopPropagation()}>
                          <button className="btn-danger" onClick={() => handleDeleteFloor(floor.id)} title="Eliminar piso">
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
                                <button className="btn-edit" onClick={() => setSelectedDept({ tower, floor, dept })} title="Editar / Residentes">
                                  <span className="material-symbols-outlined">group</span>
                                </button>
                                <button className="btn-danger" onClick={() => handleDeleteDept(dept.id)} title="Eliminar departamento">
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
        />
      )}
    </div>
  );
}