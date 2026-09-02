import { useState, useEffect, type FormEvent } from 'react';
import { useProfile } from '../hooks/useProfile';
import { useTheme } from '../hooks/useTheme';

export function ProfilePage() {
  const { user, loading, error, success, changePassword, uploadAvatar } = useProfile();
  const { theme, toggleTheme } = useTheme();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passError, setPassError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  useEffect(() => {
    const url = (user as { avatar_url?: string } | null)?.avatar_url || null;
    if (url) setAvatarPreview(url);
  }, [user]);

  const handlePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPassError(null);
    if (newPassword !== confirmPassword) {
      setPassError('Las contraseñas no coinciden');
      return;
    }
    if (newPassword.length < 6) {
      setPassError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    await changePassword(currentPassword, newPassword);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await uploadAvatar(file);
    if (url) {
      setAvatarPreview(url);
    }
  };

  return (
    <div className="dashboard profile-page">
      <div className="header">
        <h2>Mi Perfil</h2>
      </div>

      <div className="profile-card">
        <div className="avatar-section">
          <div className="avatar-circle">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Foto de perfil" />
            ) : (
              <span className="material-symbols-outlined">person</span>
            )}
          </div>
          <label className="avatar-upload-btn">
            <span className="material-symbols-outlined">photo_camera</span> Cambiar foto
            <input type="file" accept="image/*" onChange={handleAvatar} hidden />
          </label>
        </div>

        <div className="profile-info">
          <h3>{user?.name || user?.email}</h3>
          <p>{user?.email}</p>
        </div>
      </div>

      <div className="theme-card">
        <h3>Tema</h3>
        <p>Selecciona el modo de visualización de la aplicación.</p>
        <button onClick={toggleTheme} className="theme-toggle-btn">
          <span className="material-symbols-outlined">{theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
          {theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'}
        </button>
      </div>

      <div className="password-card">
        <h3>Cambiar Contraseña</h3>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        {passError && <div className="error-message">{passError}</div>}

        <form onSubmit={handlePassword}>
          <div className="form-group">
            <label>Contraseña actual</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Nueva contraseña</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
          </div>
          <div className="form-group">
            <label>Confirmar nueva contraseña</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
          </div>
          <button type="submit" disabled={loading}>
            <span className="material-symbols-outlined">lock_reset</span> {loading ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>
    </div>
  );
}