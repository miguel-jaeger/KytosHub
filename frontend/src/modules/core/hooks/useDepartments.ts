import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import type { Department, ApiResponse } from '../types';

export function useDepartments(towerId?: string) {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDepartments = useCallback(async () => {
    if (!schemaName) { setDepartments([]); setLoading(false); return; }
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Department[]>>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: towerId }
      });
      if (fnError) throw fnError;
      if (data?.success && data.data) {
        setDepartments(data.data);
      } else {
        setDepartments([]);
        setError(data?.error?.message || 'Error al cargar departamentos');
      }
    } catch (err) {
      setDepartments([]);
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, towerId]);

  useEffect(() => { fetchDepartments(); }, [fetchDepartments]);

  const createDepartment = async (dept: Omit<Department, 'id' | 'created_at'>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Department>>('departments', { method: 'POST', body: { action: 'create', schema_name: schemaName, ...dept } });
    if (fnError) throw fnError;
    if (data?.success) { await fetchDepartments(); return data.data; }
    throw new Error(data?.error?.message || 'Error al crear departamento');
  };

  const updateDepartment = async (id: string, updates: Partial<Department>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Department>>('departments', { method: 'POST', body: { action: 'update', id, schema_name: schemaName, ...updates } });
    if (fnError) throw fnError;
    if (data?.success) { await fetchDepartments(); return data.data; }
    throw new Error(data?.error?.message || 'Error al actualizar departamento');
  };

  const deleteDepartment = async (id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>('departments', { method: 'POST', body: { action: 'delete', id, schema_name: schemaName } });
    if (fnError) throw fnError;
    if (data?.success) { await fetchDepartments(); return true; }
    throw new Error(data?.error?.message || 'Error al eliminar departamento');
  };

  return { departments, loading, error, fetchDepartments, createDepartment, updateDepartment, deleteDepartment };
}