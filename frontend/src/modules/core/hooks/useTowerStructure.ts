import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import type { TowerNode, ApiResponse } from '../types';

export function useTowerStructure() {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const [towers, setTowers] = useState<TowerNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStructure = useCallback(async () => {
    if (!schemaName) {
      setError('No hay un condominio activo');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<TowerNode[]>>(`tower-structure?schema_name=${encodeURIComponent(schemaName)}`);

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
  }, [schemaName]);

  useEffect(() => {
    fetchStructure();
  }, [fetchStructure]);

  return {
    towers,
    loading,
    error,
    refresh: fetchStructure
  };
}