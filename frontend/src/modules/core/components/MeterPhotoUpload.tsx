import { useRef, useState, type ChangeEvent } from 'react';
import { uploadReadingPhoto } from '../../../lib/cloudinary';

export function MeterPhotoUpload({
  value,
  onChange,
  folder,
  disabled
}: {
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  folder: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url, error: upErr } = await uploadReadingPhoto(file, folder);
      if (upErr) {
        setError(upErr);
      } else if (url) {
        onChange(url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir la foto');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  if (value) {
    return (
      <div className="meter-photo-upload">
        <div className="meter-photo-preview">
          <img src={value} alt="Foto de lectura actual" />
          {!disabled && (
            <button type="button" className="icon-btn danger" title="Quitar foto" onClick={() => onChange(null)}>
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
        {!disabled && (
          <button type="button" className="btn-cancel" onClick={() => inputRef.current?.click()}>
            <span className="material-symbols-outlined">photo_camera</span> Cambiar foto
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="meter-photo-upload">
      <button type="button" className="btn-cancel" disabled={disabled || uploading} onClick={() => inputRef.current?.click()}>
        <span className="material-symbols-outlined">{uploading ? 'progress_activity' : 'photo_camera'}</span>
        {uploading ? 'Subiendo foto...' : 'Adjuntar foto de lectura'}
      </button>
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
      {error && <small className="text-on-surface-variant">{error}</small>}
    </div>
  );
}