import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { Gate } from '../types';

export function useCondoGates() {
  const list = useCallback(async (schemaName: string): Promise<Gate[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Gate[] | null; error: { message: string } | null }>('condo-gates', {
      method: 'POST',
      body: { action: 'list', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar puertas');
    return data.data || [];
  }, []);

  const create = useCallback(async (schemaName: string, gate: Partial<Gate>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Gate | null; error: { message: string } | null }>('condo-gates', {
      method: 'POST',
      body: { action: 'create', schema_name: schemaName, ...gate }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al crear puerta');
    return data.data;
  }, []);

  const update = useCallback(async (schemaName: string, id: string, changes: Partial<Gate>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Gate | null; error: { message: string } | null }>('condo-gates', {
      method: 'POST',
      body: { action: 'update', schema_name: schemaName, id, ...changes }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al guardar puerta');
    return data.data;
  }, []);

  const remove = useCallback(async (schemaName: string, id: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('condo-gates', {
      method: 'POST',
      body: { action: 'delete', schema_name: schemaName, id }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al eliminar puerta');
  }, []);

  return { list, create, update, remove };
}
