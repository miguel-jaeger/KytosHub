import { invokeFunction } from '../../../lib/insforge';
import type { ModuleInfo } from '../types';

export interface ModulesListResult {
  is_superadmin: boolean;
  modules: ModuleInfo[];
}

export function useCondoModules() {
  const list = async (schemaName: string): Promise<ModulesListResult> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ModulesListResult | null; error: { message: string } | null }>('condo-modules', {
      method: 'POST',
      body: { action: 'list', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al cargar módulos');
    return data.data;
  };

  const update = async (
    schemaName: string,
    moduleKey: string,
    changes: { is_enabled?: boolean; config?: Record<string, unknown> }
  ): Promise<ModuleInfo | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ModuleInfo | null; error: { message: string } | null }>('condo-modules', {
      method: 'POST',
      body: { action: 'update', schema_name: schemaName, module_key: moduleKey, ...changes }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar módulo');
    return data.data;
  };

  return { list, update };
}