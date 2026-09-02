const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';

const buildFolder = (shortName: string) => `condominios/${shortName}`;

export async function uploadCondominiumImage(
  file: File,
  shortName: string
): Promise<{ url: string; error: string | null }> {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    return { url: '', error: 'Cloudinary no está configurado (VITE_CLOUDINARY_CLOUD_NAME / VITE_CLOUDINARY_UPLOAD_PRESET)' };
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', buildFolder(shortName));

  try {
    const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('Cloudinary upload error:', response.status, text);
      return { url: '', error: `No se pudo subir la imagen (HTTP ${response.status})` };
    }

    const data = await response.json();
    return { url: data.secure_url as string, error: null };
  } catch (err) {
    console.error('Cloudinary upload failed:', err);
    return { url: '', error: err instanceof Error ? err.message : 'Error al subir la imagen' };
  }
}

export const cloudinaryFolder = (shortName: string) => buildFolder(shortName);