import { useState, useEffect } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { Resident, ApiResponse } from '../types';

export function useResidents(departmentId?: string) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResidents = async () => {
    try {
      setLoading(true);
      const params = departmentId ? `?department_id=${departmentId}` : '';
      const { data, error: fnError } = await invokeFunction<ApiResponse<Resident[]>>(`residents${params}`);

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setResidents(data.data);
      } else {
        setError(data?.error?.message || 'Error al cargar residentes');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResidents();
  }, [departmentId]);

  const createResident = async (resident: Omit<Resident, 'id' | 'created_at'>) => {
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>('residents', {
      method: 'POST',
      body: resident
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchResidents();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear residente');
  };

  const updateResident = async (id: string, updates: Partial<Resident>) => {
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>('residents', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchResidents();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al actualizar residente');
  };

  const deleteResident = async (id: string) => {
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>('residents', {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    if (data?.success) {
      await fetchResidents();
      return true;
    }
    throw new Error(data?.error?.message || 'Error al eliminar residente');
  };

  return {
    residents,
    loading,
    error,
    fetchResidents,
    createResident,
    updateResident,
    deleteResident
  };
}
