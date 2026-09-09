export interface Tower {
  id: string;
  name: string;
  code: string;
  floors_count: number;
  departments_per_floor: number;
  created_at: string;
}

export interface Floor {
  id: string;
  tower_id: string;
  floor_number: number;
  created_at: string;
}

export interface Department {
  id: string;
  floor_id: string;
  tower_id: string;
  department_number: string;
  status: 'HABITADO' | 'DESOCUPADO' | 'MANTENIMIENTO';
  created_at: string;
  towers?: { name: string; code: string };
  floors?: { floor_number: number };
}

export interface Resident {
  id: string;
  department_id: string;
  full_name: string;
  document_type: 'DNI' | 'CE' | 'PASAPORTE';
  document_number: string;
  relationship_type: 'PROPIETARIO' | 'FAMILIAR' | 'INQUILINO';
  is_primary_contact: boolean;
  email: string | null;
  phone: string | null;
  user_id?: string | null;
  created_at: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string };
  };
}

export interface ProvisionTowerRequest {
  tower_name: string;
  tower_code: string;
  floors_count: number;
  departments_per_floor: number;
  naming_pattern?: 'SEQUENTIAL' | 'FLOOR_DEPT';
}

export interface ProvisionTowerResult {
  tower_id: string;
  tower_name: string;
  tower_code: string;
  floors_created: number;
  departments_created: number;
}

export interface DepartmentNode {
  id: string;
  department_number: string;
  status: 'HABITADO' | 'DESOCUPADO' | 'MANTENIMIENTO';
  residents_count?: number;
}

export interface FloorNode {
  id: string;
  floor_number: number;
  departments: DepartmentNode[];
}

export interface TowerNode {
  id: string;
  name: string;
  code: string;
  floors_count: number;
  departments_per_floor: number;
  created_at: string;
  floors: FloorNode[];
}

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
}

export type WizardStep = 'condominium' | 'towers' | 'residents';

export interface ModuleInfo {
  module_key: string;
  name: string;
  description: string;
  is_enabled: boolean;
  config_json: Record<string, unknown>;
  editable?: boolean;
}

export interface CartLendingConfig {
  max_loan_minutes: number;
  fine_enabled: boolean;
  fine_type: string;
  grace_period_minutes: number;
  fine_amount: number;
  fine_interval_minutes: number;
}

export interface Cart {
  id: string;
  code_identifier: string;
  qr_code_hash?: string | null;
  status: 'DISPONIBLE' | 'PRESTADO' | 'MANTENIMIENTO';
  notes?: string | null;
  created_at: string;
}

export interface CartLoan {
  id: string;
  cart_id: string;
  department_id: string;
  requested_by_user_id?: string | null;
  guard_checkout_user_id?: string | null;
  guard_checkin_user_id?: string | null;
  checkout_time: string;
  due_time: string;
  checkin_time?: string | null;
  status: 'ACTIVO' | 'DEVUELTO' | 'ATRASADO';
  penalty_amount: number;
  penalty_status: 'NINGUNA' | 'PENDIENTE' | 'COBRADA' | 'EXONERADA';
  created_at: string;
  cart_code?: string | null;
  department_number?: string | null;
  tower_code?: string | null;
  overtime_minutes?: number;
}
