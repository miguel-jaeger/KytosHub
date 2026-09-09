import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type { Cart, CartLendingConfig, CartLoan, FinesSummaryRow } from '../types';

export interface LoansResult {
  loans: CartLoan[];
  config: CartLendingConfig;
}

export interface FinesFilters {
  start_date?: string;
  end_date?: string;
  tower_id?: string;
  floor_id?: string;
  department_id?: string;
}

export function useCartLending() {
  const listCarts = useCallback(async (schemaName: string): Promise<Cart[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Cart[] | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'list-carts', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar carritos');
    return data.data || [];
  }, []);

  const createCart = useCallback(async (schemaName: string, cart: { code_identifier: string; status?: string; cart_type?: string; gate_id?: string | null; notes?: string }) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Cart | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'create-cart', schema_name: schemaName, ...cart }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar carrito');
    return data.data;
  }, []);

  const updateCart = useCallback(async (schemaName: string, id: string, updates: Partial<Cart>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Cart | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'update-cart', schema_name: schemaName, id, ...updates }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar carrito');
    return data.data;
  }, []);

  const deleteCart = useCallback(async (schemaName: string, id: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'delete-cart', schema_name: schemaName, id }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al eliminar carrito');
  }, []);

  const listLoans = useCallback(async (schemaName: string, activeOnly = false): Promise<LoansResult> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: LoansResult | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'list-loans', schema_name: schemaName, active_only: activeOnly }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al cargar préstamos');
    return data.data;
  }, []);

  const finesSummary = useCallback(async (schemaName: string, filters: FinesFilters = {}): Promise<FinesSummaryRow[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: FinesSummaryRow[] | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'fines-summary', schema_name: schemaName, ...filters }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar multas');
    return data.data || [];
  }, []);

  const checkout = useCallback(async (schemaName: string, cartId: string, departmentId: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: CartLoan | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'checkout', schema_name: schemaName, cart_id: cartId, department_id: departmentId }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar préstamo');
    return data.data;
  }, []);

  const checkin = useCallback(async (schemaName: string, loanId: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: CartLoan | null; error: { message: string } | null }>('cart-lending', {
      method: 'POST',
      body: { action: 'checkin', schema_name: schemaName, loan_id: loanId }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar devolución');
    return data.data;
  }, []);

  return { listCarts, createCart, updateCart, deleteCart, listLoans, checkout, checkin, finesSummary };
}