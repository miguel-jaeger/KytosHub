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
  can_toggle?: boolean;
  can_edit_config?: boolean;
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

export interface Gate {
  id: string;
  name: string;
  code: string | null;
  is_entry_exit: boolean;
  carts_carga: number;
  carts_compra: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Cart {
  id: string;
  code_identifier: string;
  qr_code_hash?: string | null;
  status: 'DISPONIBLE' | 'PRESTADO' | 'MANTENIMIENTO';
  gate_id?: string | null;
  gate?: ({ id: string; name: string; code: string | null; carts_carga: number; carts_compra: number } | null);
  cart_type?: 'CARGA' | 'COMPRA' | string;
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
  cart_gate?: ({ id: string; name: string } | null);
  cart_type?: string;
  department_number?: string | null;
  tower_code?: string | null;
  elapsed_minutes?: number;
  overtime_minutes?: number;
  estimated_fine?: number;
}

export interface FinesSummaryRow {
  department_id: string;
  department_number: string | null;
  tower_code: string | null;
  total_fine: number;
  count: number;
  pending: number;
  cobrada: number;
}

export type ParkingSpotType = 'PROPIO' | 'VISITA' | 'ALQUILADO';
export type VehicleType = 'AUTO' | 'MOTO';
export type ParkingLoanStatus = 'PENDIENTE' | 'ACTIVO' | 'FINALIZADO' | 'CANCELADO';

export interface ParkingSpot {
  id: string;
  spot_number: string;
  type: ParkingSpotType;
  department_id: string | null;
  status: 'DISPONIBLE' | 'OCUPADO';
  spot_row?: number | null;
  spot_index?: number | null;
  created_at: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string };
  };
  inside?: boolean;
}

export interface ParkingLayout {
  rows: number;
  spots_per_row: number[] | number;
  total_spots?: number;
}

export interface Vehicle {
  id: string;
  department_id: string;
  license_plate: string;
  vehicle_type: VehicleType;
  driver_name: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  is_active: boolean;
  created_by_user_id?: string | null;
  created_at: string;
  departments?: {
    department_number: string;
    floor_number?: number | null;
    towers?: { id: string; name: string; code: string };
  };
}

export type RentalDurationUnit = 'HORAS' | 'DIAS' | 'MESES';

export interface ParkingLoan {
  id: string;
  spot_id: string;
  lender_department_id: string;
  borrower_department_id: string | null;
  borrower_vehicle_plate: string | null;
  borrower_vehicle_type: VehicleType | null;
  occupant_name: string | null;
  occupant_document_type: string | null;
  occupant_document_number: string | null;
  duration_unit: RentalDurationUnit | null;
  start_time: string;
  end_time: string;
  status: ParkingLoanStatus;
  created_at: string;
  spot_number?: string | null;
  spot_type?: string | null;
  lender_department?: { department_number: string; tower_code: string | null } | null;
  borrower_department?: { department_number: string; tower_code: string | null } | null;
  borrower_vehicle_department_id?: string | null;
}

export interface ParkingAccessLog {
  id: string;
  spot_id: string | null;
  license_plate: string;
  vehicle_type: VehicleType;
  driver_name: string | null;
  entry_time: string;
  exit_time: string | null;
  entry_gate_id?: string | null;
  exit_gate_id?: string | null;
  authorized_by_user_id?: string | null;
  guard_user_id?: string | null;
  created_at: string;
  spot_number?: string | null;
  spot_type?: string | null;
  entry_gate?: { id: string; name: string } | null;
  exit_gate?: { id: string; name: string } | null;
  guard_name?: string | null;
}

export interface PlateStatus {
  license_plate: string;
  vehicle: Vehicle | null;
  driver_name: string | null;
  inside: boolean;
  current_log: ParkingAccessLog | null;
  inside_spot: { id: string; spot_number: string; type: string } | null;
  entry_gate: { id: string; name: string } | null;
  visitor_spots: Array<{ id: string; spot_number: string }>;
  rented_spots: Array<{ id: string; spot_number: string }>;
}

export interface OcrResult {
  plate: string | null;
  full_text: string;
  detected: string[];
}

export interface GuardGateSession {
  id: string;
  gate: { id: string; name: string; code: string | null; is_entry_exit: boolean };
  started_at: string;
}

export interface EntryRegisterResult {
  log: ParkingAccessLog;
  spot: { id: string; spot_number: string; type: string };
  authorization: string;
  entry_gate: { id: string; name: string } | null;
}

export interface ExitRegisterResult {
  log: ParkingAccessLog;
  exit_gate: { id: string; name: string } | null;
}

export interface CondoStats {
  id: number;
  access_total: number;
  access_inside: number;
  access_entry_today: number;
  access_exit_total: number;
  access_exit_today: number;
  vehicles_total: number;
  spots_total: number;
  spots_occupied: number;
  parking_loans_total: number;
  parking_loans_active: number;
  carts_total: number;
  carts_disponible: number;
  carts_prestado: number;
  carts_mantenimiento: number;
  cart_loans_total: number;
  cart_loans_active: number;
}

export type VisitorVisitStatus = 'PENDIENTE' | 'ACTIVO' | 'EXPIRADO' | 'CANCELADO';

export interface VisitorVisit {
  id: string;
  department_id: string | null;
  full_name: string;
  document_type: string;
  document_number: string;
  vehicle_plate: string | null;
  vehicle_type: VehicleType;
  scheduled_start: string;
  scheduled_end: string | null;
  entry_time: string | null;
  exit_time: string | null;
  status: VisitorVisitStatus;
  access_code: string;
  created_by_user_id: string | null;
  created_at: string;
  inside?: boolean;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string };
  };
}

export interface VisitorPackage {
  id: string;
  department_id: string | null;
  description: string;
  carrier: string | null;
  received_at: string;
  notified: boolean;
  delivered_at: string | null;
  created_at: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string };
  };
}

export type BoardRole = 'PRESIDENTE' | 'SECRETARIO' | 'TESORERO';

export interface TowerBoard {
  id: string;
  tower_id: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  towers?: { id: string; name: string; code: string } | null;
  members?: TowerBoardMember[];
}

export interface TowerBoardMember {
  id: string;
  board_id: string;
  resident_id: string;
  role: BoardRole;
  created_at: string;
  residents?: {
    id: string;
    full_name: string;
    document_type: string;
    document_number: string;
    department_id: string;
    departments?: {
      department_number: string;
      towers?: { id: string; name: string; code: string } | null;
    } | null;
  } | null;
}

export interface GeneralBoard {
  id: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  members?: GeneralBoardMember[];
}

export interface GeneralBoardMember {
  id: string;
  board_id: string;
  board_member_id: string;
  role: BoardRole;
  created_at: string;
  board_member?: {
    id: string;
    board_id: string;
    resident_id: string;
    role: BoardRole;
    residents?: {
      id: string;
      full_name: string;
      document_type: string;
      document_number: string;
      department_id: string;
      departments?: {
        department_number: string;
        towers?: { id: string; name: string; code: string } | null;
      } | null;
    } | null;
    tower_board?: {
      id: string;
      tower_id: string;
      start_date: string;
      end_date: string;
      is_active: boolean;
      towers?: { id: string; name: string; code: string } | null;
    } | null;
  } | null;
}

export interface GeneralBoardCandidate {
  board_member_id: string;
  role: BoardRole;
  residents?: {
    id: string;
    full_name: string;
    document_type: string;
    document_number: string;
    department_id: string;
    departments?: {
      department_number: string;
      towers?: { id: string; name: string; code: string } | null;
    } | null;
  } | null;
  tower_board?: {
    id: string;
    tower_id: string;
    start_date: string;
    end_date: string;
    is_active: boolean;
    towers?: { id: string; name: string; code: string } | null;
  } | null;
}

export interface BillingConfig {
  default_fee: number;
  due_days: number;
  autolink_cart_fines: boolean;
}

export type InvoiceStatus = 'PENDIENTE' | 'PARCIAL' | 'PAGADA' | 'ANULADA';

export interface BillingCycle {
  id: string;
  cycle_key: string;
  label: string;
  start_date: string;
  end_date: string;
  due_date: string;
  is_closed: boolean;
  created_at: string;
  stats?: {
    total_invoices: number;
    paid_invoices: number;
    pending_invoices: number;
    collected: number;
    morosos: number;
  };
}

export interface DepartmentFee {
  department_id: string;
  department_number: string;
  floor_id?: string | null;
  floor_number?: number | null;
  tower: { id: string; name: string; code: string } | null;
  amount: number;
  is_exempt: boolean;
  notes: string | null;
}

export type FineSource = 'CART_LOAN' | 'OPERATIVE';
export type FineStatus = 'PENDIENTE' | 'PAGADA' | 'ANULADA';

export interface BillingFine {
  id: string;
  invoice_id: string | null;
  department_id: string;
  source: FineSource;
  cart_loan_id: string | null;
  concept: string;
  amount: number;
  status: FineStatus;
  created_at: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string } | null;
  } | null;
}

export interface BillingVariableData {
  meters: Array<{ label: string; value: string }>;
  items: MaintenanceReceiptItem[];
}

export interface BillingInvoice {
  id: string;
  cycle_id: string;
  department_id: string;
  amount: number;
  paid_amount: number;
  status: InvoiceStatus;
  due_date: string;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  fine_total: number;
  total: number;
  receipt_data: MaintenanceReceipt | null;
  variable_data: BillingVariableData | null;
  department_number?: string;
  tower_code?: string;
  edificio?: string;
  departamento?: string;
  titular?: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string } | null;
  } | null;
  cycles?: {
    id: string;
    cycle_key: string;
    label: string;
    start_date: string;
    end_date: string;
    due_date: string;
  } | null;
  fines?: BillingFine[];
}

export interface MaintenanceReceiptItem {
  categoria: string;
  descripcion: string;
  cantidad: string | null;
  monto_total_gasto: number | null;
  importe_departamento: number;
}

export interface MaintenanceReceipt {
  numero_recibo: string;
  periodo: string;
  fecha_emision: string;
  fecha_vencimiento: string;
  moneda: string;
  simbolo_moneda: string;
  subtotal: number;
  ajustes: number;
  total_mes: number;
  deuda_total_acumulada: number;
  estado_morosidad: string;
  condominio: string;
  titular: string;
  edificio: string;
  departamento: string;
  identificador_vivienda: string;
  codigo_recaudacion: string;
  plataforma_recaudacion: string;
  items: MaintenanceReceiptItem[];
  marcas_agua: Array<{ label: string; value: string }>;
  entidades_autorizadas: string[];
  regla_codigo_pago: string;
  pasos_pago: string[];
  notas_pago: string[];
  acciones_del_mes: string[];
  contacto_soporte: string;
  plataforma_software: string;
}

export interface BillingPayment {
  id: string;
  invoice_id: string;
  department_id: string;
  amount: number;
  payment_date: string;
  notes: string | null;
  registered_by_user_id: string | null;
  created_at: string;
  departments?: {
    department_number: string;
    towers?: { name: string; code: string } | null;
  } | null;
  invoices?: {
    id: string;
    cycle_id: string;
    amount: number;
    status: InvoiceStatus;
    due_date: string;
  } | null;
}

export interface MorosoRow {
  department_id: string;
  department_number: string;
  tower_id: string;
  tower: { id: string; name: string; code: string } | null;
  pending_count: number;
  pending_amount: number;
  overdue: boolean;
  overdue_amount: number;
  invoices: Array<{
    id: string;
    amount: number;
    paid_amount: number;
    remaining: number;
    due_date: string;
    cycles: { id: string; label: string; end_date: string } | null;
  }>;
  fines: Array<{ id: string; amount: number; concept: string }>;
}

export interface MorososReport {
  towers: Array<{ tower_id: string; name: string; code: string; pending_amount: number; departments_morosos: number }>;
  departments: MorosoRow[];
  total_pending: number;
  total_departments_morosos: number;
}
