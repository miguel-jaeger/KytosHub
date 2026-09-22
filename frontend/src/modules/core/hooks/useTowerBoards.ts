import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { invokeFunction } from '../../../lib/insforge';
import type { TowerBoard } from '../types';

interface BoardApiResponse<D> {
  success: boolean;
  data: D | null;
  error: { code: string; message: string } | null;
}

export function useTowerBoards(schemaName?: string, enabled = true) {
  const { user } = useAuth();
  const [boards, setBoards] = useState<TowerBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBoards = useCallback(async () => {
    if (!schemaName || !enabled) { setBoards([]); setLoading(false); return; }
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<BoardApiResponse<TowerBoard[]>>('tower-boards', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      if (fnError) throw fnError;
      if (data?.success) {
        setBoards(data.data || []);
      } else {
        setBoards([]);
        setError(data?.error?.message || 'Error al cargar juntas directivas de torre');
      }
    } catch (err) {
      setBoards([]);
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, enabled, user]);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);

  const createBoard = async (payload: {
    tower_id: string;
    start_date: string;
    end_date?: string;
    notes?: string;
    members: Array<{ resident_id: string; role: string }>;
  }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BoardApiResponse<TowerBoard>>('tower-boards', {
      method: 'POST',
      body: { action: 'create', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) {
      await fetchBoards();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear la junta directiva');
  };

  const deactivateBoard = async (id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BoardApiResponse<TowerBoard>>('tower-boards', {
      method: 'POST',
      body: { action: 'deactivate', schema_name: schemaName, id }
    });
    if (fnError) throw fnError;
    if (data?.success) {
      await fetchBoards();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al desactivar la junta directiva');
  };

  return { boards, loading, error, fetchBoards, createBoard, deactivateBoard };
}