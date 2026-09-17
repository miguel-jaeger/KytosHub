import { useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import type {
  EntryRegisterResult,
  ExitRegisterResult,
  OcrResult,
  ParkingAccessLog,
  ParkingLayout,
  ParkingLoan,
  ParkingLoanStatus,
  ParkingSpot,
  PlateStatus,
  Vehicle
} from '../types';

export function useParking() {
  const listSpots = useCallback(async (schemaName: string, opts: { department_id?: string; type?: string } = {}): Promise<ParkingSpot[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingSpot[] | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'list-spots', schema_name: schemaName, ...opts }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar bahías');
    return data.data || [];
  }, []);

  const createSpot = useCallback(async (schemaName: string, spot: Partial<ParkingSpot>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingSpot | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'create-spot', schema_name: schemaName, ...spot }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al crear bahía');
    return data.data;
  }, []);

  const updateSpot = useCallback(async (schemaName: string, id: string, changes: Partial<ParkingSpot>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingSpot | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'update-spot', schema_name: schemaName, id, ...changes }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar bahía');
    return data.data;
  }, []);

  const deleteSpot = useCallback(async (schemaName: string, id: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'delete-spot', schema_name: schemaName, id }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al eliminar bahía');
  }, []);

  const listVehicles = useCallback(async (schemaName: string, opts: { department_id?: string } = {}): Promise<Vehicle[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Vehicle[] | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'list-vehicles', schema_name: schemaName, ...opts }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar vehículos');
    return data.data || [];
  }, []);

  const createVehicle = useCallback(async (schemaName: string, vehicle: Partial<Vehicle>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Vehicle | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'create-vehicle', schema_name: schemaName, ...vehicle }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al registrar vehículo');
    return data.data;
  }, []);

  const updateVehicle = useCallback(async (schemaName: string, id: string, changes: Partial<Vehicle>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Vehicle | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'update-vehicle', schema_name: schemaName, id, ...changes }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar vehículo');
    return data.data;
  }, []);

  const updateVehicleDriver = useCallback(async (schemaName: string, licensePlate: string, driverName: string): Promise<Vehicle | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Vehicle | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'update-vehicle-driver', schema_name: schemaName, license_plate: licensePlate, driver_name: driverName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar el conductor');
    return data.data;
  }, []);

  const deleteVehicle = useCallback(async (schemaName: string, id: string) => {
    const { data, error } = await invokeFunction<{ success: boolean; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'delete-vehicle', schema_name: schemaName, id }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al eliminar vehículo');
  }, []);

  const listLoans = useCallback(async (schemaName: string, opts: { spot_id?: string; lender_department_id?: string } = {}): Promise<ParkingLoan[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingLoan[] | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'list-loans', schema_name: schemaName, ...opts }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar préstamos');
    return data.data || [];
  }, []);

  const createLoan = useCallback(async (schemaName: string, loan: Partial<ParkingLoan>) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingLoan | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'create-loan', schema_name: schemaName, ...loan }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al crear préstamo de bahía');
    return data.data;
  }, []);

  const updateLoanStatus = useCallback(async (schemaName: string, id: string, status: ParkingLoanStatus) => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingLoan | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'update-loan-status', schema_name: schemaName, id, status }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al actualizar préstamo');
    return data.data;
  }, []);

  const plateStatus = useCallback(async (schemaName: string, licensePlate: string): Promise<PlateStatus> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: PlateStatus | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'plate-status', schema_name: schemaName, license_plate: licensePlate }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al consultar la placa');
    return data.data;
  }, []);

  const searchPlates = useCallback(async (schemaName: string, search: string): Promise<Vehicle[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: Vehicle[] | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'search-plates', schema_name: schemaName, search }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al buscar placas');
    return data.data || [];
  }, []);

  const registerEntry = useCallback(async (schemaName: string, input: { license_plate: string; vehicle_type?: string; driver_name?: string; spot_id?: string; gate_id?: string }): Promise<EntryRegisterResult> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: EntryRegisterResult | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'register-entry', schema_name: schemaName, ...input }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al registrar ingreso');
    return data.data;
  }, []);

  const registerExit = useCallback(async (schemaName: string, input: { license_plate: string; gate_id?: string }): Promise<ExitRegisterResult> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ExitRegisterResult | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'register-exit', schema_name: schemaName, ...input }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al registrar salida');
    return data.data;
  }, []);

  const listLogs = useCallback(async (schemaName: string, opts: { inside_only?: boolean; limit?: number; license_plate?: string; driver_name?: string; from_date?: string; to_date?: string } = {}): Promise<ParkingAccessLog[]> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingAccessLog[] | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'list-logs', schema_name: schemaName, ...opts }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al cargar registros de acceso');
    return data.data || [];
  }, []);

  const getLayout = useCallback(async (schemaName: string): Promise<ParkingLayout | null> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: ParkingLayout | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'get-layout', schema_name: schemaName }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'Error al consultar el layout');
    return data.data;
  }, []);

  const provisionLayout = useCallback(async (schemaName: string, rows: number, spotsPerRow: number | number[]): Promise<{ layout: ParkingLayout; result: Record<string, unknown>; spots: ParkingSpot[] }> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: { layout: ParkingLayout; result: Record<string, unknown>; spots: ParkingSpot[] } | null; error: { message: string } | null }>('parking-control', {
      method: 'POST',
      body: { action: 'provision-layout', schema_name: schemaName, rows, spots_per_row: spotsPerRow }
    });
    if (error) throw error;
    if (!data?.success || !data.data) throw new Error(data?.error?.message || 'Error al generar el layout');
    return data.data;
  }, []);

  const ocrPlate = useCallback(async (image: string): Promise<OcrResult> => {
    const { data, error } = await invokeFunction<{ success: boolean; data: OcrResult | null; error: { message: string } | null }>('plate-ocr', {
      method: 'POST',
      body: { image }
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error?.message || 'No se pudo reconocer la placa');
    return data.data || { plate: null, full_text: '', detected: [] };
  }, []);

  const ocrConfigured = useCallback(async (): Promise<boolean> => {
    const { data } = await invokeFunction<{ success: boolean; data: { configured: boolean } | null }>('plate-ocr', {
      method: 'POST',
      body: { action: 'status' }
    });
    return Boolean(data?.success && data.data?.configured);
  }, []);

  return {
    listSpots, createSpot, updateSpot, deleteSpot,
    listVehicles, createVehicle, updateVehicle, updateVehicleDriver, deleteVehicle,
    listLoans, createLoan, updateLoanStatus,
    plateStatus, searchPlates, registerEntry, registerExit, listLogs,
    getLayout, provisionLayout, ocrPlate, ocrConfigured
  };
}