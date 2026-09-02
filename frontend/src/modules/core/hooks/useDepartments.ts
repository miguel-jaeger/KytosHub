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
    if (!schemaName) {
      setError('No hay un condominio activo');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ schema_name: schemaName });
      if (towerId) params.set('tower_id', towerId);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Department[]>>(`departments?${params.toString()}`);

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setDepartments(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar departamentos');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, towerId]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const createDepartment = async (dept: Omit<Department, 'id' | 'created_at'>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Department>>(`departments?schema_name=${encodeURIComponent(schemaName)}`, {
      method: 'POST',
      body: dept
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchDepartments();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear departamento');
  };

  const updateDepartment = async (id: string, updates: Partial<Department>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Department>>(`departments?schema_name=${encodeURIComponent(schemaName)}`, {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchDepartments();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al actualizar departamento');
  };

  const deleteDepartment = async (id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>(`departments?schema_name=${encodeURIComponent(schemaName)}`, {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchDepartments();
      return true;
    }
    throw new Error(data?.error?.message || 'Error al eliminar departamento');
  };

  return {
    departments,
    loading,
    error,
    fetchDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment
  };
}