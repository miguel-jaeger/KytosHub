import { invokeFunction } from '../../../lib/insforge';
import { useAuth } from '../../../contexts/AuthContext';
import type { ActiveCondominium } from '../../../contexts/CondominiumContext';

interface RegisterCondominiumResult {
  tenant_id: string;
  name: string;
  slug: string;
  short_name: string;
  schema_name: string;
  image_url: string | null;
}

interface RegisterPayload {
  name: string;
  short_name?: string;
  address?: string;
  admin_phone?: string;
  image_url?: string;
  owner_user_id?: string;
}

export function useCondominiumRegistration() {
  const { user } = useAuth();

  const register = async (payload: RegisterPayload): Promise<ActiveCondominium> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: RegisterCondominiumResult | null; error: { message: string } | null }>(
      'register-condominium',
      {
        method: 'POST',
        body: {
          ...payload,
          owner_user_id: user?.id || undefined
        }
      }
    );

    if (error) throw error;
    if (!data?.success || !data.data) {
      throw new Error(data?.error?.message || 'Error al registrar el condominio');
    }

    return {
      tenant_id: data.data.tenant_id,
      name: data.data.name,
      slug: data.data.slug,
      short_name: data.data.short_name,
      schema_name: data.data.schema_name,
      image_url: data.data.image_url
    };
  };

  return { register };
}