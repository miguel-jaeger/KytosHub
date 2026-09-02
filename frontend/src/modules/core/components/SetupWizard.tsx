import { useState } from 'react';
import { useCondominium } from '../../../contexts/CondominiumContext';
import { useCondominiumRegistration } from '../hooks/useCondominiumRegistration';
import { useTowerStructure } from '../hooks/useTowerStructure';
import { TowerWizard } from './TowerWizard';
import { ResidentsManager } from './ResidentsManager';
import type { TowerNode } from '../types';

type WizardStep = 'condominium' | 'towers' | 'residents';

export function SetupWizard() {
  const { condominium, setCondominium } = useCondominium();
  const { register } = useCondominiumRegistration();
  const { towers, loading: towersLoading } = useTowerStructure();
  const [step, setStep] = useState<WizardStep>(condominium ? 'towers' : 'condominium');
  const [selectedTower, setSelectedTower] = useState<TowerNode | null>(null);
  const [showTowerWizard, setShowTowerWizard] = useState(false);

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
          <span>3. Residentes</span>
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
              <input type="text" value={condoData.short_name} onChange={e => setCondoData({ ...condoData, short_name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '') })} placeholder="Ej: gardenias" required />
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
              <label>Logo del Condominio (opcional)</label>
              <input type="file" accept="image/*" onChange={e => setCondoImageFile(e.target.files?.[0] || null)} />
            </div>
            {condoError && <div className="error-message">{condoError}</div>}
            <div className="wizard-actions">
              <button type="submit" disabled={condoLoading}>{condoLoading ? 'Creando...' : 'Siguiente →'}</button>
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
        <span className={step === 'towers' ? 'active' : step === 'residents' ? 'done' : ''}>2. Estructura</span>
        <span className={step === 'residents' ? 'active' : ''}>3. Residentes</span>
      </div>
      <div className="wizard-nav">
        <button className={step === 'towers' ? 'active' : ''} onClick={() => { setStep('towers'); setSelectedTower(null); setShowTowerWizard(false); }}>Torres</button>
        <button className={step === 'residents' ? 'active' : ''} onClick={() => setStep('residents')}>Residentes</button>
      </div>

      {step === 'towers' && (
        <div className="structure-section">
          {towersLoading ? (
            <div className="loading-message">Cargando estructura...</div>
          ) : towers.length === 0 ? (
            <div className="empty-state">
              <p>No hay torres registradas.</p>
              <button onClick={() => setShowTowerWizard(true)}>Crear primera torre</button>
            </div>
          ) : (
            <>
              <div className="structure-header">
                <h3>Torres del Condominio</h3>
                <button onClick={() => setShowTowerWizard(true)}>+ Agregar Torre</button>
              </div>
              {showTowerWizard && <TowerWizard onComplete={() => setShowTowerWizard(false)} />}
              {towers.map(tower => (
                <div key={tower.id} className="tower-card" onClick={() => setSelectedTower(selectedTower?.id === tower.id ? null : tower)}>
                  <div className="tower-header">
                    <span className="tower-icon">{selectedTower?.id === tower.id ? '▼' : '▶'}</span>
                    <div className="tower-info">
                      <h3>{tower.name}</h3>
                      <span className="tower-code">Código: {tower.code}</span>
                    </div>
                    <div className="tower-stats">
                      <span>{tower.floors.length} pisos</span>
                      <span>{tower.floors.reduce((sum, f) => sum + f.departments.length, 0)} deptos</span>
                    </div>
                  </div>
                  {selectedTower?.id === tower.id && (
                    <div className="tower-floors">
                      {tower.floors.map(floor => (
                        <div key={floor.id} className="floor-row">
                          <span className="floor-label">Piso {floor.floor_number}</span>
                          <div className="department-tags">
                            {floor.departments.map(dept => (
                              <span key={dept.id} className="department-tag">Dpto {dept.department_number}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {step === 'residents' && <ResidentsManager />}
    </div>
  );
}