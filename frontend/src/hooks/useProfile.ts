import { useState, useCallback } from 'react';
import { invokeFunction } from '../lib/insforge';
import { useAuth } from '../contexts/AuthContext';

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';

export function useProfile() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const { data, error: fnError } = await invokeFunction<{ success: boolean; error?: { message?: string } }>('resident-account', {
        method: 'POST',
        body: { action: 'change-password', current_password: currentPassword, new_password: newPassword }
      });
      if (fnError) throw fnError;
      if (!data?.success) throw new Error(data?.error?.message || 'Error al cambiar contraseña');
      setSuccess('Contraseña actualizada correctamente');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadAvatar = async (file: File): Promise<string | null> => {
    if (!CLOUD_NAME || !UPLOAD_PRESET) {
      setError('Cloudinary no configurado');
      return null;
    }
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', UPLOAD_PRESET);
      fd.append('folder', 'avatars');
      const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: fd });
      if (!res.ok) throw new Error('No se pudo subir la imagen');
      const data = await res.json();
      const url = data.secure_url as string;
      const { insforge } = await import('../lib/insforge');
      await insforge.auth.setProfile({ avatar_url: url });
      return url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir imagen');
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    user,
    loading,
    error,
    success,
    changePassword,
    uploadAvatar,
    clearError: () => setError(null),
    clearSuccess: () => setSuccess(null)
  };
}