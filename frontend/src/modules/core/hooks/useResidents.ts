import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import type { Resident, ApiResponse } from '../types';

export function useResidents(departmentId?: string) {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchResidents = useCallback(async () => {
    if (!schemaName) {
      setError('No hay un condominio activo');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ schema_name: schemaName });
      if (departmentId) params.set('department_id', departmentId);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Resident[]>>(`residents?${params.toString()}`);

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
  }, [schemaName, departmentId]);

  useEffect(() => {
    fetchResidents();
  }, [fetchResidents]);

  const createResident = async (resident: Omit<Resident, 'id' | 'created_at'>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>(`residents?schema_name=${encodeURIComponent(schemaName)}`, {
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
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>(`residents?schema_name=${encodeURIComponent(schemaName)}`, {
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
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>(`residents?schema_name=${encodeURIComponent(schemaName)}`, {
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