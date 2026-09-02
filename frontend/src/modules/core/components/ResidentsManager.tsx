import { useState, type FormEvent } from 'react';
import { useResidents } from '../hooks/useResidents';
import type { Resident } from '../types';

export function ResidentsManager({ departmentId }: { departmentId?: string }) {
  const { residents, loading, error, fetchResidents } = useResidents(departmentId);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    department_id: departmentId || '',
    full_name: '',
    document_type: 'DNI' as Resident['document_type'],
    document_number: '',
    relationship_type: 'PROPIETARIO' as Resident['relationship_type'],
    is_primary_contact: false,
    email: '',
    phone: ''
  });

  const resetForm = () => {
    setFormData({
      department_id: departmentId || '',
      full_name: '',
      document_type: 'DNI',
      document_number: '',
      relationship_type: 'PROPIETARIO',
      is_primary_contact: false,
      email: '',
      phone: ''
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await fetchResidents();
      setShowForm(false);
      resetForm();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const relLabel: Record<string, string> = { PROPIETARIO: 'Propietario', FAMILIAR: 'Familiar', INQUILINO: 'Inquilino' };

  if (loading) return <div>Cargando residentes...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="residents-manager">
      <div className="header">
        <h2>Residentes</h2>
        <button onClick={() => { resetForm(); setShowForm(true); }}>Adicionar</button>
      </div>

      {showForm && (
        <form className="form-modal" onSubmit={handleSubmit}>
          <h3>Agregar Residente</h3>
          <div className="form-group"><label>Nombre completo</label><input type="text" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} required /></div>
          <div className="form-group"><label>Documento</label><select value={formData.document_type} onChange={e => setFormData({ ...formData, document_type: e.target.value as Resident['document_type'] })}><option value="DNI">DNI</option><option value="CE">CE</option><option value="PASAPORTE">Pasaporte</option></select></div>
          <div className="form-group"><label>Número</label><input type="text" value={formData.document_number} onChange={e => setFormData({ ...formData, document_number: e.target.value })} required /></div>
          <div className="form-group"><label>Relación</label><select value={formData.relationship_type} onChange={e => setFormData({ ...formData, relationship_type: e.target.value as Resident['relationship_type'] })}><option value="PROPIETARIO">Propietario</option><option value="FAMILIAR">Familiar</option><option value="INQUILINO">Inquilino</option></select></div>
          <div className="form-actions"><button type="button" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" disabled={submitting}>{submitting ? 'Guardando...' : 'Adicionar'}</button></div>
        </form>
      )}

      <table>
        <thead><tr><th>Nombre</th><th>Documento</th><th>Tipo</th><th>Contacto</th></tr></thead>
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
    </div>
  );
}
