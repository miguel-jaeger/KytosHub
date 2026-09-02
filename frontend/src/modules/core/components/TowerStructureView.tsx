import { useState, type FormEvent } from 'react';
import { useTowerStructure } from '../hooks/useTowerStructure';
import { useResidents } from '../hooks/useResidents';
import type { TowerNode, DepartmentNode, Resident } from '../types';

const statusLabel: Record<DepartmentNode['status'], string> = {
  HABITADO: 'Habitado',
  DESOCUPADO: 'Desocupado',
  MANTENIMIENTO: 'En mantenimiento'
};

const statusClass: Record<DepartmentNode['status'], string> = {
  HABITADO: 'status-occupied',
  DESOCUPADO: 'status-vacant',
  MANTENIMIENTO: 'status-maintenance'
};

const relLabel: Record<Resident['relationship_type'], string> = {
  PROPIETARIO: 'Propietario',
  FAMILIAR: 'Familiar',
  INQUILINO: 'Inquilino'
};

interface SelectedDept {
  towerName: string;
  towerCode: string;
  floorNumber: number;
  department: DepartmentNode;
  departmentId: string;
}

export function TowerStructureView() {
  const { towers, loading, error, refresh } = useTowerStructure();
  const [expandedTowers, setExpandedTowers] = useState<Set<string>>(new Set());
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [selectedDept, setSelectedDept] = useState<SelectedDept | null>(null);

  const toggleTower = (id: string) => {
    setExpandedTowers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleFloor = (id: string) => {
    setExpandedFloors(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const totalDepartments = (tower: TowerNode) =>
    tower.floors.reduce((sum, floor) => sum + floor.departments.length, 0);

  if (loading) return <div className="loading-message">Cargando estructura...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="tower-structure">
      <div className="header">
        <h2>Estructura del Condominio</h2>
        <button onClick={refresh}>Actualizar</button>
      </div>

      {towers.length === 0 ? (
        <div className="empty-state">
          <p>No hay torres registradas.</p>
          <p>Use el asistente de configuración para crear la estructura inicial.</p>
        </div>
      ) : (
        <div className="tower-list">
          {towers.map(tower => {
            const isTowerOpen = expandedTowers.has(tower.id);
            return (
              <div key={tower.id} className="tower-card">
                <div className="tower-header" onClick={() => toggleTower(tower.id)}>
                  <span className="tower-icon">{isTowerOpen ? '▼' : '▶'}</span>
                  <div className="tower-info">
                    <h3>{tower.name}</h3>
                    <span className="tower-code">Código: {tower.code}</span>
                  </div>
                  <div className="tower-stats">
                    <span>{tower.floors.length} pisos</span>
                    <span>{totalDepartments(tower)} departamentos</span>
                  </div>
                </div>

                {isTowerOpen && (
                  <div className="floor-list">
                    {tower.floors.map(floor => {
                      const isFloorOpen = expandedFloors.has(floor.id);
                      return (
                        <div key={floor.id} className="floor-card">
                          <div className="floor-header" onClick={() => toggleFloor(floor.id)}>
                            <span className="floor-icon">{isFloorOpen ? '▼' : '▶'}</span>
                            <span className="floor-label">Piso {floor.floor_number}</span>
                            <span className="floor-count">{floor.departments.length} deptos</span>
                          </div>

                          {isFloorOpen && (
                            <div className="department-grid">
                              {floor.departments.map(dept => (
                                <div
                                  key={dept.id}
                                  className="department-card clickable"
                                  onClick={() => setSelectedDept({
                                    towerName: tower.name,
                                    towerCode: tower.code,
                                    floorNumber: floor.floor_number,
                                    department: dept,
                                    departmentId: dept.id
                                  })}
                                >
                                  <span className="department-number">Depto {dept.department_number}</span>
                                  <span className={`status-badge ${statusClass[dept.status]}`}>
                                    {statusLabel[dept.status]}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedDept && (
        <DepartmentModal
          towerName={selectedDept.towerName}
          towerCode={selectedDept.towerCode}
          floorNumber={selectedDept.floorNumber}
          department={selectedDept.department}
          departmentId={selectedDept.departmentId}
          onClose={() => setSelectedDept(null)}
        />
      )}
    </div>
  );
}

function DepartmentModal({
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
  const { residents, loading: residentsLoading, fetchResidents } = useResidents(departmentId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    full_name: '',
    document_type: 'DNI' as Resident['relationship_type'] extends 'PROPIETARIO' | 'FAMILIAR' | 'INQUILINO' ? 'DNI' | 'CE' | 'PASAPORTE' : 'DNI',
    document_number: '',
    relationship_type: 'PROPIETARIO' as Resident['relationship_type'],
    is_primary_contact: false,
    email: '',
    phone: ''
  });

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await fetchResidents();
      setShowForm(false);
      setFormData({
        full_name: '',
        document_type: 'DNI',
        document_number: '',
        relationship_type: 'PROPIETARIO',
        is_primary_contact: false,
        email: '',
        phone: ''
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al agregar residente');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Depto {department.department_number}</h3>
          <p className="text-on-surface-variant">{towerName} ({towerCode}) - Piso {floorNumber} - {statusLabel[department.status]}</p>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="residents-list">
            <div className="residents-header">
              <h4>Residentes</h4>
              <button onClick={() => setShowForm(true)}>+ Adicionar</button>
            </div>

            {residentsLoading ? (
              <p>Cargando residentes...</p>
            ) : residents.length === 0 ? (
              <p className="empty-text">No hay residentes registrados en este departamento.</p>
            ) : (
              <table className="residents-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Documento</th>
                    <th>Tipo</th>
                    <th>Contacto</th>
                  </tr>
                </thead>
                <tbody>
                  {residents.map(r => (
                    <tr key={r.id}>
                      <td>{r.full_name}{r.is_primary_contact ? ' ★' : ''}</td>
                      <td>{r.document_type} {r.document_number}</td>
                      <td>{relLabel[r.relationship_type]}</td>
                      <td>{r.email || r.phone || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {showForm && (
            <form className="resident-form" onSubmit={handleSubmit}>
              <h4>Agregar Residente</h4>

              <div className="form-group">
                <label>Nombre completo</label>
                <input
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Juan Pérez"
                  required
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de documento</label>
                  <select
                    value={formData.document_type}
                    onChange={(e) => setFormData({ ...formData, document_type: e.target.value as 'DNI' | 'CE' | 'PASAPORTE' })}
                  >
                    <option value="DNI">DNI</option>
                    <option value="CE">CE</option>
                    <option value="PASAPORTE">Pasaporte</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Número de documento</label>
                  <input
                    type="text"
                    value={formData.document_number}
                    onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
                    placeholder="12345678"
                    required
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Relación</label>
                  <select
                    value={formData.relationship_type}
                    onChange={(e) => setFormData({ ...formData, relationship_type: e.target.value as Resident['relationship_type'] })}
                  >
                    <option value="PROPIETARIO">Propietario</option>
                    <option value="FAMILIAR">Familiar</option>
                    <option value="INQUILINO">Inquilino</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+51 999 888 777"
                  />
                </div>
              </div>

              {formData.relationship_type === 'PROPIETARIO' && (
                <div className="form-group">
                  <label>Email (se creará cuenta de acceso)</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="correo@ejemplo.com"
                  />
                  <small>Se creará una cuenta para que el propietario pueda iniciar sesión en el sistema.</small>
                </div>
              )}

              <div className="form-group checkbox">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_primary_contact}
                    onChange={(e) => setFormData({ ...formData, is_primary_contact: e.target.checked })}
                  />
                  Contacto principal
                </label>
              </div>

              {error && <div className="error-message">{error}</div>}

              <div className="form-actions">
                <button type="button" onClick={() => setShowForm(false)}>Cancelar</button>
                <button type="submit" disabled={submitting}>
                  {submitting ? 'Guardando...' : 'Adicionar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}