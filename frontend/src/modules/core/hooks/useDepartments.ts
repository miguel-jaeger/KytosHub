import { useState, useEffect } from 'react';
import { insforge } from '../../../lib/insforge';
import type { Department, ApiResponse } from '../types';

export function useDepartments(towerId?: string) {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      const params = towerId ? `?tower_id=${towerId}` : '';
      const { data, error: fnError } = await insforge.functions.invoke(`departments${params}`, {
        method: 'GET'
      });

      if (fnError) throw fnError;

      const response: ApiResponse<Department[]> = await data.json();
      if (response.success && response.data) {
        setDepartments(response.data);
      } else {
        setError(response.error?.message || 'Error al cargar departamentos');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDepartments();
  }, [towerId]);

  const createDepartment = async (dept: Omit<Department, 'id' | 'created_at'>) => {
    const { data, error: fnError } = await insforge.functions.invoke('departments', {
      method: 'POST',
      body: dept
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Department> = await data.json();
    if (response.success) {
      await fetchDepartments();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al crear departamento');
  };

  const updateDepartment = async (id: string, updates: Partial<Department>) => {
    const { data, error: fnError } = await insforge.functions.invoke('departments', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Department> = await data.json();
    if (response.success) {
      await fetchDepartments();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al actualizar departamento');
  };

  const deleteDepartment = async (id: string) => {
    const { data, error: fnError } = await insforge.functions.invoke('departments', {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<null> = await data.json();
    if (response.success) {
      await fetchDepartments();
      return true;
    }
    throw new Error(response.error?.message || 'Error al eliminar departamento');
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
