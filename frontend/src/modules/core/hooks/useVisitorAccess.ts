import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { VisitorPackage, VisitorVisit } from '../types';

export function useVisitorAccess() {
  const listVisits = useCallback(async (schemaName: string, filters: { status?: string; search?: string } = {}): Promise<VisitorVisit[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorVisit[] | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'list-visits', schema_name: schemaName, ...filters }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar visitas');
    return data.data || [];
  }, []);

  const createVisit = useCallback(async (schemaName: string, input: Partial<VisitorVisit>): Promise<VisitorVisit | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorVisit | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'create-visit', schema_name: schemaName, ...input }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar la visita');
    return data.data;
  }, []);

  const updateVisitStatus = useCallback(async (schemaName: string, id: string, op: 'confirm-entry' | 'confirm-exit' | 'cancel'): Promise<VisitorVisit | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorVisit | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'update-visit-status', schema_name: schemaName, id, operation: op }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar la visita');
    return data.data;
  }, []);

  const listPackages = useCallback(async (schemaName: string): Promise<VisitorPackage[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorPackage[] | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'list-packages', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar paquetes');
    return data.data || [];
  }, []);

  const createPackage = useCallback(async (schemaName: string, input: Partial<VisitorPackage>): Promise<VisitorPackage | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorPackage | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'create-package', schema_name: schemaName, ...input }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar el paquete');
    return data.data;
  }, []);

  const updatePackage = useCallback(async (schemaName: string, id: string, op: 'notify' | 'deliver'): Promise<VisitorPackage | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: VisitorPackage | null; error: { message: string } | null }>('visitor-access', {
      method: 'POST',
      body: { action: 'update-package', schema_name: schemaName, id, operation: op }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar el paquete');
    return data.data;
  }, []);

  return { listVisits, createVisit, updateVisitStatus, listPackages, createPackage, updatePackage };
}