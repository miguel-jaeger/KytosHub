import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { TowerNode, ApiResponse } from '../types';

export function useTowerStructure() {
  const [towers, setTowers] = useState<TowerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStructure = async () => {
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<TowerNode[]>>('tower-structure');

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setTowers(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar la estructura');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStructure();
  }, []);

  return {
    towers,
    loading,
    error,
    refresh: fetchStructure
  };
}