import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { GuardGateSession } from '../types';

export function useGuardGate() {
  const getSession = useCallback(async (schemaName: string): Promise<GuardGateSession | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: GuardGateSession | null; error: { message: string } | null }>('guard-gate', {
      method: 'POST',
      body: { action: 'get-session', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al consultar la puerta del guardia');
    return data.data;
  }, []);

  const checkIn = useCallback(async (schemaName: string, gateId: string): Promise<GuardGateSession> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: GuardGateSession | null; error: { message: string } | null }>('guard-gate', {
      method: 'POST',
      body: { action: 'check-in', schema_name: schemaName, gate_id: gateId }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al registrar la puerta');
    return data.data;
  }, []);

  const changeGate = useCallback(async (schemaName: string, gateId: string): Promise<GuardGateSession> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: GuardGateSession | null; error: { message: string } | null }>('guard-gate', {
      method: 'POST',
      body: { action: 'change-gate', schema_name: schemaName, gate_id: gateId }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al cambiar la puerta');
    return data.data;
  }, []);

  const checkOut = useCallback(async (schemaName: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('guard-gate', {
      method: 'POST',
      body: { action: 'check-out', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cerrar sesión de puerta');
  }, []);

  return { getSession, checkIn, changeGate, checkOut };
}