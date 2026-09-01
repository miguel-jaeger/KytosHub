import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { Tower, ApiResponse, ProvisionTowerRequest } from '../types';

export function useTowers() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTowers = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Tower[]>>('towers');

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
  };

  useEffect(() => {
    fetchTowers();
  }, []);

  const createTower = async (tower: ProvisionTowerRequest) => {
    const { data, error: fnError } = await invokeFunction<{ success: boolean; data: Tower | null; error: { code: string; message: string } | null }>('provision-tower', {
      method: 'POST',
      body: tower
    });

    if (fnError) throw fnError;

    if (data?.success && data.data) {
      setTowers(prev => [...prev, data.data!]);
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear torre');
  };

  const updateTower = async (id: string, updates: Partial<Tower>) => {
    const { data, error: fnError } = await invokeFunction<ApiResponse<Tower>>('towers', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchTowers();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al actualizar torre');
  };

  const deleteTower = async (id: string) => {
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>('towers', {
      method: 'DELETE',
      body: { id }
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
