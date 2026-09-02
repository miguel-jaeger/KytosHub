import { useState, useEffect, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useCondominium } from '../../../contexts/CondominiumContext';
import type { Resident, ApiResponse } from '../types';

export function useResidents(departmentId?: string) {
  const { condominium } = useCondominium();
  const schemaName = condominium?.schema_name;
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchResidents = useCallback(async () => {
    if (!schemaName) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<ApiResponse<Resident[]>>('residents', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, department_id: departmentId }
      });

      if (fnError) throw fnError;

      if (data?.success && data.data) {
        setResidents(data.data);
      } else {
        setResidents([]);
        setError(data?.error?.message || 'Error al cargar residentes');
      }
    } catch (err) {
      setResidents([]);
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, departmentId]);

  useEffect(() => { fetchResidents(); }, [fetchResidents]);

  const createResident = async (resident: Omit<Resident, 'id' | 'created_at'>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>('residents', {
      method: 'POST',
      body: { action: 'create', schema_name: schemaName, ...resident }
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
    const { data, error: fnError } = await invokeFunction<ApiResponse<Resident>>('residents', {
      method: 'POST',
      body: { action: 'update', id, schema_name: schemaName, ...updates }
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
    const { data, error: fnError } = await invokeFunction<ApiResponse<null>>('residents', {
      method: 'POST',
      body: { action: 'delete', id, schema_name: schemaName }
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