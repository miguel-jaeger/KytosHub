import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import type { Tower, ApiResponse, ProvisionTowerRequest, ProvisionTowerResult } from '../types';

export function useTowers() {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const [towers, setTowers] = useState<Tower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTowers = useCallback(async () => {
    if (!schemaName) {
      setError('No hay un condominio activo');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Tower[]>>(`towers?schema_name=${encodeURIComponent(schemaName)}`);

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setTowers(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar torres');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName]);

  useEffect(() => {
    fetchTowers();
  }, [fetchTowers]);

  const createTower = async (tower: ProvisionTowerRequest) => {
    if (!schemaName) throw new Error('No hay un condominio activo');

    const { data, error: fnError } = await invokeFunction<{ success: boolean; data: ProvisionTowerResult | null; error: { code: string; message: string } | null }>('provision-tower', {
      method: 'POST',
      body: { ...tower, schema_name: schemaName }
    });

    if (fnError) throw fnError;

    if (data?.success && data.data) {
      await fetchTowers();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear torre');
  };

  const updateTower = async (id: string, updates: Partial<Tower>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');

    const { data, error: fnError } = await invokeFunction<ApiResponse<Tower>>(`towers?schema_name=${encodeURIComponent(schemaName)}`, {
      method: 'PUT',
      body: { id, ...updates, schema_name: schemaName }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchTowers();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al actualizar torre');
  };

  const deleteTower = async (id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');

    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>(`towers?schema_name=${encodeURIComponent(schemaName)}`, {
      method: 'DELETE',
      body: { id, schema_name: schemaName }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchTowers();
      return true;
    }
    throw new Error(data?.error?.message || 'Error al eliminar torre');
  };

  return {
    towers,
    loading,
    error,
    fetchTowers,
    createTower,
    updateTower,
    deleteTower
  };
}