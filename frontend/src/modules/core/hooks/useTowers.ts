import { useState, useEffect } from 'react';
import { insforge } from '../../../lib/insforge';
import type { Tower, ApiResponse, ProvisionTowerRequest } from '../types';

export function useTowers() {
  const [towers, setTowers] = useState<Tower[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTowers = async () => {
    try {
      setLoading(true);
      const { data, error: fnError } = await insforge.functions.invoke('towers', {
        method: 'GET'
      });

      if (fnError) throw fnError;

      const response: ApiResponse<Tower[]> = await data.json();
      if (response.success && response.data) {
        setTowers(response.data);
      } else {
        setError(response.error?.message || 'Error al cargar torres');
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
    const { data, error: fnError } = await insforge.functions.invoke('provision-tower', {
      method: 'POST',
      body: tower
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Tower> = await data.json();
    if (response.success) {
      await fetchTowers();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al crear torre');
  };

  const updateTower = async (id: string, updates: Partial<Tower>) => {
    const { data, error: fnError } = await insforge.functions.invoke('towers', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Tower> = await data.json();
    if (response.success) {
      await fetchTowers();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al actualizar torre');
  };

  const deleteTower = async (id: string) => {
    const { data, error: fnError } = await insforge.functions.invoke('towers', {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<null> = await data.json();
    if (response.success) {
      await fetchTowers();
      return true;
    }
    throw new Error(response.error?.message || 'Error al eliminar torre');
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
