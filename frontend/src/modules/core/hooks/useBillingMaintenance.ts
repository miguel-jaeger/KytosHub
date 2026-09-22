import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../../contexts/AuthContext';
import { invokeFunction } from '../../../lib/insforge';
import type { BillingConfig, BillingCycle, DepartmentFee, BillingInvoice, BillingFine, BillingPayment, MaintenanceReceipt, MorososReport } from '../types';

interface BillingApiResponse<D> {
  success: boolean;
  data: D | null;
  error: { code: string; message: string } | null;
}

export function useBillingMaintenance(schemaName?: string, enabled = true) {
  const { user } = useAuth();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [periods, setPeriods] = useState<BillingCycle[]>([]);
  const [departmentFees, setDepartmentFees] = useState<DepartmentFee[]>([]);
  const [invoices, setInvoices] = useState<BillingInvoice[]>([]);
  const [fines, setFines] = useState<BillingFine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!schemaName || !enabled) { setLoading(false); return; }
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [c, p, f] = await Promise.all([
        invokeFunction<BillingApiResponse<BillingConfig>>('billing-maintenance', { method: 'POST', body: { action: 'get-config', schema_name: schemaName } }),
        invokeFunction<BillingApiResponse<BillingCycle[]>>('billing-maintenance', { method: 'POST', body: { action: 'list-periods', schema_name: schemaName } }),
        invokeFunction<BillingApiResponse<DepartmentFee[]>>('billing-maintenance', { method: 'POST', body: { action: 'list-department-fees', schema_name: schemaName } })
      ]);
      if (c.data?.success) setConfig(c.data.data);
      if (p.data?.success) setPeriods(p.data.data || []);
      if (f.data?.success) setDepartmentFees(f.data.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error de conexión');
    } finally {
      setLoading(false);
    }
  }, [schemaName, enabled, user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const updateConfig = async (payload: Partial<BillingConfig>) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingConfig>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'update-config', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) { setConfig(data.data); return data.data; }
    throw new Error(data?.error?.message || 'Error al guardar la configuración');
  };

  const createPeriod = async (payload: { label: string; start_date: string; end_date: string; due_date?: string; amount?: number }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingCycle>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'create-period', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) { await fetchAll(); return data.data; }
    throw new Error(data?.error?.message || 'Error al crear el período');
  };

  const generateInvoices = async (period_id: string, regenerate = false) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<{ period_id: string; created: number }>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'generate-invoices', schema_name: schemaName, period_id, regenerate }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data?.created || 0;
    throw new Error(data?.error?.message || 'Error al generar recibos');
  };

  const regenerateInvoices = async (period_id: string) => generateInvoices(period_id, true);

  const setDepartmentFee = async (payload: { department_id: string; amount: number; is_exempt: boolean; notes?: string }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<unknown>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'set-department-fee', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) { await fetchAll(); return; }
    throw new Error(data?.error?.message || 'Error al configurar la cuota');
  };

  const fetchInvoices = async (filters: { period_id?: string; status?: string; department_id?: string }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingInvoice[]>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'list-invoices', schema_name: schemaName, ...filters }
    });
    if (fnError) throw fnError;
    if (data?.success) { setInvoices(data.data || []); return data.data || []; }
    throw new Error(data?.error?.message || 'Error al cargar recibos');
  };

  const fetchFines = async (department_id?: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingFine[]>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'list-fines', schema_name: schemaName, department_id }
    });
    if (fnError) throw fnError;
    if (data?.success) { setFines(data.data || []); return data.data || []; }
    throw new Error(data?.error?.message || 'Error al cargar multas');
  };

  const registerPayment = async (payload: { invoice_id: string; amount: number; notes?: string }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<unknown>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'register-payment', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) return true;
    throw new Error(data?.error?.message || 'Error al registrar el pago');
  };

  const addFine = async (payload: { department_id: string; concept: string; amount: number; invoice_id?: boolean }) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingFine>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'add-fine', schema_name: schemaName, ...payload }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data;
    throw new Error(data?.error?.message || 'Error al registrar la multa');
  };

  const payFine = async (fine_id: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<unknown>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'pay-fine', schema_name: schemaName, fine_id }
    });
    if (fnError) throw fnError;
    if (data?.success) return true;
    throw new Error(data?.error?.message || 'Error al pagar la multa');
  };

  const syncCartFines = async () => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<{ created: number }>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'sync-cart-fines', schema_name: schemaName }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data?.created || 0;
    throw new Error(data?.error?.message || 'Error al sincronizar multas de carritos');
  };

  const fetchPayments = async (department_id?: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<BillingPayment[]>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'list-payments', schema_name: schemaName, department_id }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data || [];
    throw new Error(data?.error?.message || 'Error al cargar el historial de pagos');
  };

  const fetchMyState = async () => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<{ department_id: string; invoices: BillingInvoice[]; fines: BillingFine[] }>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'my-invoices', schema_name: schemaName }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data;
    throw new Error(data?.error?.message || 'Error al cargar tu estado de cuenta');
  };

  const fetchMorosos = async (tower_id?: string) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<MorososReport>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'morosos', schema_name: schemaName, tower_id }
    });
    if (fnError) throw fnError;
    if (data?.success) return data.data;
    throw new Error(data?.error?.message || 'Error al cargar morosos');
  };

  const saveReceipt = async (invoice_id: string, receipt_data: MaintenanceReceipt) => {
    if (!schemaName) throw new Error('No hay un condominio activo');
    const { data, error: fnError } = await invokeFunction<BillingApiResponse<unknown>>('billing-maintenance', {
      method: 'POST',
      body: { action: 'save-receipt', schema_name: schemaName, invoice_id, receipt_data }
    });
    if (fnError) throw fnError;
    if (data?.success) return true;
    throw new Error(data?.error?.message || 'Error al guardar el recibo');
  };

  return {
    config, periods, departmentFees, invoices, fines, loading, error,
    fetchAll, updateConfig, createPeriod, generateInvoices, regenerateInvoices, setDepartmentFee,
    fetchInvoices, fetchFines, fetchPayments, fetchMyState, fetchMorosos, saveReceipt,
    registerPayment, addFine, payFine, syncCartFines
  };
}