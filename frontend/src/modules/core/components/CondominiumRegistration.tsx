import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { uploadCondominiumImage } from '../../../lib/cloudinary';
import { useCondominiumRegistration } from '../hooks/useCondominiumRegistration';
import { useCondominium } from '../../../contexts/CondominiumContext';

interface CondominiumRegistrationProps {
  onRegistered: () => void;
}

export function CondominiumRegistration({ onRegistered }: CondominiumRegistrationProps) {
  const { register } = useCondominiumRegistration();
  const { setCondominium } = useCondominium();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [address, setAddress] = useState('');
  const [adminPhone, setAdminPhone] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deriveShortName = (value: string) =>
    value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const handleNameChange = (value: string) => {
    setName(value);
    if (!shortName) {
      setShortName(deriveShortName(value));
    }
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
    setError(null);
  };

  const effectiveShortName = shortName || deriveShortName(name);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setUploading(true);

    try {
      let imageUrl: string | undefined;

      if (imageFile) {
        const { url, error: uploadError } = await uploadCondominiumImage(imageFile, effectiveShortName);
        if (uploadError) {
          throw new Error(uploadError);
        }
        imageUrl = url;
      }

      setSubmitting(true);
      const condo = await register({
        name,
        short_name: effectiveShortName,
        address,
        admin_phone: adminPhone,
        image_url: imageUrl
      });

      setCondominium(condo);
      onRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al registrar el condominio');
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  };

  return (
    <div className="condo-registration">
      <div className="wizard-header">
        <h2>Datos del Condominio</h2>
        <p className="form-hint">Registra tu condominio antes de configurar su estructura.</p>
      </div>

      <form className="condo-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label>Nombre del Condominio</label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Ej: Condominio Las Gardenias"
            required
          />
        </div>

        <div className="form-group">
          <label>Nombre Corto (identificador)</label>
          <input
            type="text"
            value={effectiveShortName}
            onChange={(e) => setShortName(deriveShortName(e.target.value))}
            placeholder="Ej: gardenias"
            required
          />
          <small>Se usará para el esquema de datos y la carpeta de imágenes en Cloudinary.</small>
        </div>

        <div className="form-group">
          <label>Dirección</label>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Av. Los Olivos 123, Lima"
            rows={3}
          />
        </div>

        <div className="form-group">
          <label>Teléfono de la Administración</label>
          <input
            type="text"
            value={adminPhone}
            onChange={(e) => setAdminPhone(e.target.value)}
            placeholder="+51 999 888 777"
          />
        </div>

        <div className="form-group">
          <label>Imagen del Condominio</label>
          <div className="image-uploader">
            {imagePreview ? (
              <div className="image-preview">
                <img src={imagePreview} alt="Vista previa del condominio" />
              </div>
            ) : (
              <div className="image-placeholder">
                <span className="material-symbols-outlined">add_a_photo</span>
                <p>Selecciona una imagen</p>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {imagePreview ? 'Cambiar imagen' : 'Subir imagen'}
            </button>
          </div>
          <small>La imagen se guarda en Cloudinary en la carpeta <code>condominios/{effectiveShortName}/</code></small>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="wizard-actions">
          <button type="submit" disabled={submitting || uploading}>
            {uploading ? 'Subiendo imagen...' : submitting ? 'Registrando...' : 'Registrar Condominio'}
          </button>
        </div>
      </form>
    </div>
  );
}