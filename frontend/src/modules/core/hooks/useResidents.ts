import { useState, useEffect } from 'react';
import { insforge } from '../../../lib/insforge';
import type { Resident, ApiResponse } from '../types';

export function useResidents(departmentId?: string) {
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResidents = async () => {
    try {
      setLoading(true);
      const params = departmentId ? `?department_id=${departmentId}` : '';
      const { data, error: fnError } = await insforge.functions.invoke(`residents${params}`, {
        method: 'GET'
      });

      if (fnError) throw fnError;

      const response: ApiResponse<Resident[]> = await data.json();
      if (response.success && response.data) {
        setResidents(response.data);
      } else {
        setError(response.error?.message || 'Error al cargar residentes');
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
    const { data, error: fnError } = await insforge.functions.invoke('residents', {
      method: 'POST',
      body: resident
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Resident> = await data.json();
    if (response.success) {
      await fetchResidents();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al crear residente');
  };

  const updateResident = async (id: string, updates: Partial<Resident>) => {
    const { data, error: fnError } = await insforge.functions.invoke('residents', {
      method: 'PUT',
      body: { id, ...updates }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<Resident> = await data.json();
    if (response.success) {
      await fetchResidents();
      return response.data;
    }
    throw new Error(response.error?.message || 'Error al actualizar residente');
  };

  const deleteResident = async (id: string) => {
    const { data, error: fnError } = await insforge.functions.invoke('residents', {
      method: 'DELETE',
      body: { id }
    });

    if (fnError) throw fnError;

    const response: ApiResponse<null> = await data.json();
    if (response.success) {
      await fetchResidents();
      return true;
    }
    throw new Error(response.error?.message || 'Error al eliminar residente');
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
