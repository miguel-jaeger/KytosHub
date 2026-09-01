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
  user_id: string;
  is_owner: boolean;
  relationship_type: 'PROPIETARIO' | 'FAMILIAR' | 'INQUILINO';
  is_primary_contact: boolean;
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

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
}
