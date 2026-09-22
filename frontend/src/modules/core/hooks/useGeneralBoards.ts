import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { invokeFunction } from '../../../lib/insforge';
import type { GeneralBoard, GeneralBoardCandidate } from '../types';

interface BoardApiResponse<D> {
  success: boolean;
  data: D | null;
  error: { code: string; message: string } | null;
}

export function useGeneralBoards(schemaName?: string, enabled = true) {
  const { user } = useAuth();
  const [boards, setBoards] = useState<GeneralBoard[]>([]);
  const [candidates, setCandidates] = useState<GeneralBoardCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBoards = useCallback(async () => {
    if (!schemaName || !enabled) { setBoards([]); setLoading(false); return; }
    if (!user) return;
    try {
      setLoading(true);
      setError(null);
      const { data, error: fnError } = await invokeFunction<BoardApiResponse<GeneralBoard[]>>('general-boards', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      if (fnError) throw fnError;
      if (data?.success) {
        setBoards(data.data || []);
      } else {
        setBoards([]);
        setError(data?.error?.message || 'Error al cargar la junta directiva general');
      }
    } catch (err) {
      setBoards([]);
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, enabled, user]);

  const fetchCandidates = useCallback(async () => {
    if (!schemaName || !enabled) { setCandidates([]); return; }
    try {
      const { data, error: fnError } = await invokeFunction<BoardApiResponse<GeneralBoardCandidate[]>>('general-boards', {
        method: 'POST',
        body: { action: 'list-candidates', schema_name: schemaName }
      });
      if (fnError) throw fnError;
      setCandidates(data?.success ? data.data || [] : []);
    } catch {
      setCandidates([]);
    }
  }, [schemaName, enabled]);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);
  useEffect(() => { fetchCandidates(); }, [fetchCandidates]);

  const createBoard = async (payload: {
    start_date: string;
    notes?: string;
    members: Array<{ board_member_id: string; role: string }>;
  }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BoardApiResponse<GeneralBoard>>('general-boards', {
      method: 'POST',
      body: { action: 'create', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) {
      await fetchBoards();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al crear la junta directiva general');
  };

  const deactivateBoard = async (id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BoardApiResponse<GeneralBoard>>('general-boards', {
      method: 'POST',
      body: { action: 'deactivate', schema_name: schemaName, id }
    });
    if (fnError) throw fnError;
    if (data?.success) {
      await fetchBoards();
      return data.data;
    }
    throw new Error(data?.error?.message || 'Error al desactivar la junta directiva general');
  };

  return { boards, candidates, loading, error, fetchBoards, fetchCandidates, createBoard, deactivateBoard };
}