import { useState } from 'react';
import type { ProvisionTowerRequest } from '../types';
import { useTowers } from '../hooks/useTowers';

interface TowerWizardProps {
  onComplete?: () => void;
}

const initialFormData: ProvisionTowerRequest = {
  tower_name: '',
  tower_code: '',
  floors_count: 1,
  departments_per_floor: 1,
  naming_pattern: 'SEQUENTIAL'
};

export function TowerWizard({ onComplete }: TowerWizardProps) {
  const { createTower } = useTowers();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProvisionTowerRequest>(initialFormData);

  const handleChange = (field: keyof ProvisionTowerRequest, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError(null);
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await createTower(formData);
      setSuccess(`Torre creada exitosamente: ${result?.tower_name || formData.tower_name}`);
      setFormData(initialFormData);
      setStep(1);
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al crear la torre');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return formData.tower_name.trim() !== '' && formData.tower_code.trim() !== '';
      case 2:
        return formData.floors_count > 0;
      case 3:
        return formData.departments_per_floor > 0;
      default:
        return true;
    }
  };

  return (
    <div className="wizard-container">
      <div className="wizard-header">
        <h2>Configuración de Torre</h2>
        <div className="wizard-steps">
          <span className={step >= 1 ? 'active' : ''}>1. Datos básicos</span>
          <span className={step >= 2 ? 'active' : ''}>2. Pisos</span>
          <span className={step >= 3 ? 'active' : ''}>3. Departamentos</span>
        </div>
      </div>

      <div className="wizard-content">
        {step === 1 && (
          <div className="form-group">
            <label>Nombre de la Torre</label>
            <input
              type="text"
              value={formData.tower_name}
              onChange={(e) => handleChange('tower_name', e.target.value)}
              placeholder="Ej: Torre A"
            />
            <label>Código</label>
            <input
              type="text"
              value={formData.tower_code}
              onChange={(e) => handleChange('tower_code', e.target.value)}
              placeholder="Ej: TA"
            />
          </div>
        )}

        {step === 2 && (
          <div className="form-group">
            <label>Número de Pisos</label>
            <input
              type="number"
              min="1"
              value={formData.floors_count}
              onChange={(e) => handleChange('floors_count', parseInt(e.target.value) || 1)}
            />
          </div>
        )}

        {step === 3 && (
          <div className="form-group">
            <label>Departamentos por Piso</label>
            <input
              type="number"
              min="1"
              value={formData.departments_per_floor}
              onChange={(e) => handleChange('departments_per_floor', parseInt(e.target.value) || 1)}
            />
            <label>Patrón de Nomenclatura</label>
            <select
              value={formData.naming_pattern}
              onChange={(e) => handleChange('naming_pattern', e.target.value)}
            >
              <option value="SEQUENTIAL">Secuencial (101, 102, 201, 202...)</option>
              <option value="FLOOR_DEPT">Piso-Dept (0101, 0102, 0201, 0202...)</option>
            </select>
          </div>
        )}

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <div className="wizard-summary">
          <p>Se crearán:</p>
          <ul>
            <li>{formData.floors_count} pisos</li>
            <li>{formData.floors_count * formData.departments_per_floor} departamentos</li>
          </ul>
        </div>
      </div>

      <div className="wizard-actions">
        {step > 1 && (
          <button onClick={() => setStep(step - 1)} disabled={loading}>
            Anterior
          </button>
        )}
        {step < 3 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canProceed() || loading}>
            Siguiente
          </button>
        ) : (
          <button onClick={handleSubmit} disabled={!canProceed() || loading}>
            {loading ? 'Creando...' : 'Crear Torre'}
          </button>
        )}
      </div>
    </div>
  );
}
