import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';

interface Condominium {
  id: string;
  name: string;
  slug: string;
  short_name: string | null;
  schema_name: string;
  address: string | null;
  admin_phone: string | null;
  image_url: string | null;
  status: string;
  created_at: string;
  towers_count: number;
  floors_count: number;
  departments_count: number;
  residents_count: number;
}

export function useCondominiums() {
  const [condominiums, setCondominiums] = useState<Condominium[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const fetchCondominiums = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const slug = search ? `list-condominiums?search=${encodeURIComponent(search)}` : 'list-condominiums';
      const { data, error: fnError } = await invokeFunction<{ success: boolean; data: Condominium[] | null; error: { message: string } | null }>(slug);

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setCondominiums(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar condominios');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    fetchCondominiums();
  }, [fetchCondominiums]);

  const updateCondominium = async (id: string, updates: Partial<Condominium>) => {
    const { data, error: fnError } = await invokeFunction<{ success: boolean; data: Condominium | null; error: { message: string } | null }>('list-condominiums', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchCondominiums();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al actualizar condominio');
  };

  const deleteCondominium = async (id: string) => {
    const { data, error: fnError } = await invokeFunction<{ success: boolean; data: null; error: { message: string } | null }>('list-condominiums', {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchCondominiums();
      return true;
    }
    throw new Error(data?.error?.message || 'Error al eliminar condominio');
  };

  return {
    condominiums,
    loading,
    error,
    search,
    setSearch,
    fetchCondominiums,
    updateCondominium,
    deleteCondominium
  };
}