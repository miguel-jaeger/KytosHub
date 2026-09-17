import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { CondoStats } from '../types';

export function useCondoStats() {
  const getStats = useCallback(async (schemaName: string): Promise<CondoStats> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: CondoStats | null; error: { message: string } | null }>('condo-stats', {
      method: 'POST',
      body: { action: 'get', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al cargar estadísticas');
    return data.data;
  }, []);

  return { getStats };
}