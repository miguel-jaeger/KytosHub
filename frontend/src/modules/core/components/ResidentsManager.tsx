import { useState } from 'react';
import type { Resident } from '../types';
import { useResidents } from '../hooks/useResidents';
import { useDepartments } from '../hooks/useDepartments';

interface ResidentsManagerProps {
  towerId?: string;
}

export function ResidentsManager({ towerId }: ResidentsManagerProps) {
  const { residents, loading, error, createResident, updateResident, deleteResident } = useResidents();
  const { departments } = useDepartments(towerId);
  const [showForm, setShowForm] = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [formData, setFormData] = useState({
    department_id: '',
    user_id: '',
    is_owner: false,
    relationship_type: 'PROPIETARIO' as Resident['relationship_type'],
    is_primary_contact: false
  });

  const handleEdit = (resident: Resident) => {
    setEditingResident(resident);
    setFormData({
      department_id: resident.department_id,
      user_id: resident.user_id,
      is_owner: resident.is_owner,
      relationship_type: resident.relationship_type,
      is_primary_contact: resident.is_primary_contact
    });
    setShowForm(true);
  };

  const handleSubmit = async () => {
    try {
      if (editingResident) {
        await updateResident(editingResident.id, formData);
      } else {
        await createResident(formData);
      }
      setShowForm(false);
      setEditingResident(null);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar residente');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este residente?')) {
      try {
        await deleteResident(id);
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Error al eliminar residente');
      }
    }
  };

  const resetForm = () => {
    setFormData({
      department_id: '',
      user_id: '',
      is_owner: false,
      relationship_type: 'PROPIETARIO',
      is_primary_contact: false
    });
  };

  if (loading) return <div>Cargando residentes...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="residents-manager">
      <div className="header">
        <h2>Residentes</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }}>
          Agregar Residente
        </button>
      </div>

      {showForm && (
        <div className="form-modal">
          <h3>{editingResident ? 'Editar Residente' : 'Nuevo Residente'}</h3>
          <div className="form-group">
            <label>Departamento</label>
            <select
              value={formData.department_id}
              onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
            >
              <option value="">Seleccionar departamento</option>
              {departments.map(dept => (
                <option key={dept.id} value={dept.id}>
                  {dept.towers?.code} - {dept.department_number}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>ID Usuario</label>
            <input
              type="text"
              value={formData.user_id}
              onChange={(e) => setFormData({ ...formData, user_id: e.target.value })}
              placeholder="ID del usuario"
            />
          </div>
          <div className="form-group">
            <label>Tipo de Relación</label>
            <select
              value={formData.relationship_type}
              onChange={(e) => setFormData({ ...formData, relationship_type: e.target.value as Resident['relationship_type'] })}
            >
              <option value="OWNER">Propietario</option>
              <option value="FAMILY">Familiar</option>
              <option value="TENANT">Inquilino</option>
            </select>
          </div>
          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                checked={formData.is_owner}
                onChange={(e) => setFormData({ ...formData, is_owner: e.target.checked })}
              />
              Es propietario
            </label>
          </div>
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
          <div className="form-actions">
            <button onClick={() => { setShowForm(false); setEditingResident(null); }}>
              Cancelar
            </button>
            <button onClick={handleSubmit}>
              {editingResident ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Torre</th>
            <th>Depto</th>
            <th>Tipo</th>
            <th>Propietario</th>
            <th>Contacto Principal</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {residents.map(resident => (
            <tr key={resident.id}>
              <td>{resident.departments?.towers?.name || '-'}</td>
              <td>{resident.departments?.department_number || '-'}</td>
              <td>{resident.relationship_type}</td>
              <td>{resident.is_owner ? 'Sí' : 'No'}</td>
              <td>{resident.is_primary_contact ? 'Sí' : 'No'}</td>
              <td>
                <button onClick={() => handleEdit(resident)}>Editar</button>
                <button onClick={() => handleDelete(resident.id)}>Eliminar</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
