import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useCondominiumRegistration } from '../hooks/useCondominiumRegistration';
import { StructureManager } from './StructureManager';
import type { WizardStep } from '../types';

export function SetupWizard() {
  const { condominium, setCondominium } = useCondominium();
  const { register } = useCondominiumRegistration();
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>(condominium ? 'towers' : 'condominium');

  const [condoData, setCondoData] = useState({
    name: condominium?.name || '',
    short_name: condominium?.short_name || '',
    address: '',
    admin_phone: '',
  });
  const [condoImageFile, setCondoImageFile] = useState<File | null>(null);
  const [condoError, setCondoError] = useState<string | null>(null);
  const [condoLoading, setCondoLoading] = useState(false);

  const handleCondoSubmit = async () => {
    if (!condoData.name.trim()) return;
    setCondoLoading(true);
    setCondoError(null);
    try {
      let imageUrl: string | undefined;
      if (condoImageFile) {
        const CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
        const PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';
        if (CLOUD && PRESET) {
          const fd = new FormData();
          fd.append('file', condoImageFile);
          fd.append('upload_preset', PRESET);
          fd.append('folder', `condominios/${condoData.short_name || 'general'}`);
          const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, { method: 'POST', body: fd });
          if (res.ok) {
            const data = await res.json();
            imageUrl = data.secure_url;
          }
        }
      }
      const condo = await register({ ...condoData, image_url: imageUrl });
      setCondominium({ tenant_id: condo.tenant_id, name: condo.name, slug: condo.slug, short_name: condo.short_name, schema_name: condo.schema_name, image_url: imageUrl || null });
      setStep('towers');
    } catch (err) {
      setCondoError(err instanceof Error ? err.message : 'Error al registrar');
    } finally {
      setCondoLoading(false);
    }
  };

  if (step === 'condominium' && !condominium) {
    return (
      <div className="setup-wizard">
        <div className="wizard-steps">
          <span className="active">1. Datos del condominio</span>
          <span>2. Estructura</span>
        </div>
        <div className="condo-registration">
          <h2>Datos del Condominio</h2>
          <form className="condo-form" onSubmit={e => { e.preventDefault(); handleCondoSubmit(); }}>
            <div className="form-group">
              <label>Nombre del Condominio</label>
              <input type="text" value={condoData.name} onChange={e => setCondoData({ ...condoData, name: e.target.value })} placeholder="Ej: Condominio Las Gardenias" required />
            </div>
            <div className="form-group">
              <label>Nombre Corto (identificador)</label>
              <input type="text" value={condoData.short_name} onChange={e => setCondoData({ ...condoData, short_name: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '') })} placeholder="Ej: gardenias" required />
              <small>Se usará para el esquema de datos en la base de datos.</small>
            </div>
            <div className="form-group">
              <label>Dirección</label>
              <input type="text" value={condoData.address} onChange={e => setCondoData({ ...condoData, address: e.target.value })} placeholder="Av. Los Olivos 123, Lima" />
            </div>
            <div className="form-group">
              <label>Teléfono de la Administración</label>
              <input type="text" value={condoData.admin_phone} onChange={e => setCondoData({ ...condoData, admin_phone: e.target.value })} placeholder="+51 999 888 777" />
            </div>
            <div className="form-group">
              <label>Imagen del Condominio (opcional)</label>
              <input type="file" accept="image/*" onChange={e => setCondoImageFile(e.target.files?.[0] || null)} />
            </div>
            {condoError && <div className="error-message">{condoError}</div>}
            <div className="wizard-actions">
              <button type="button" className="btn-cancel" onClick={() => navigate('/admin/condominiums')}>Cancelar</button>
              <button type="submit" disabled={condoLoading}><span className="material-symbols-outlined">arrow_forward</span> {condoLoading ? 'Creando...' : 'Siguiente'}</button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-wizard">
      <div className="wizard-steps">
<span className="done">1. Datos del condominio</span>
        <span className="active">2. Estructura</span>
      </div>
      <StructureManager />
    </div>
  );
}