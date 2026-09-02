import { useState, type FormEvent } from 'react';
import { useResidents } from '../hooks/useResidents';
import type { Resident, DepartmentNode } from '../types';

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
  const { residents, loading: residentsLoading, createResident, deleteResident } = useResidents(departmentId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!formData.full_name.trim() || !formData.document_number.trim()) {
      setError('Nombre y documento son obligatorios');
      return;
    }
    setSubmitting(true);
    try {
      await createResident({
        department_id: departmentId,
        ...formData
      });
      setShowForm(false);
      setFormData({ full_name: '', document_type: 'DNI', document_number: '', relationship_type: 'PROPIETARIO', is_primary_contact: false, email: '', phone: '' });
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
              <button onClick={() => { setShowForm(!showForm); setError(null); }}>
                <span className="material-symbols-outlined">{showForm ? 'close' : 'person_add'}</span> {showForm ? 'Cancelar' : 'Agregar'}
              </button>
            </div>

            {residentsLoading ? (
              <div className="loading-message">Cargando residentes...</div>
            ) : residents.length === 0 ? (
              <p className="empty-text">No hay residentes en este departamento.</p>
            ) : (
              <table className="residents-table">
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
                  {residents.map(r => (
                    <tr key={r.id}>
                      <td>{r.full_name}{r.is_primary_contact ? ' ★' : ''}</td>
                      <td>{r.document_type} {r.document_number}</td>
                      <td>{relLabel[r.relationship_type]}</td>
                      <td>{r.email || r.phone || '-'}</td>
                      <td><button className="btn-danger" onClick={() => handleDelete(r.id)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button></td>
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
                <button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Agregar'}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}