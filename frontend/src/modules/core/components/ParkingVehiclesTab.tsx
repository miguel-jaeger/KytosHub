import { useState, useEffect, useRef, useCallback } from 'react';
import { invokeFunction } from '../../../lib/insforge';
import { useParking } from '../hooks/useParking';
import { PaginationBar, paginate } from '../../../components/Pagination';
import type { CocheraType, Department, Floor, ParkingSpot, ParkingSpotType, Tower, Vehicle, VehicleType } from '../types';

const emptyVehicleForm = { license_plate: '', vehicle_type: 'AUTO' as VehicleType, driver_name: '', brand: '', model: '', color: '' };
const VEHICLE_TYPE_LABELS: Record<VehicleType, string> = { AUTO: 'Auto', MOTO: 'Moto' };

interface VehicleImportRow {
  line: number;
  spotNumber: string;
  licensePlate: string;
  driverName: string;
  spotType: ParkingSpotType;
  cocheraType: CocheraType;
  towerCode: string;
  departmentNumber: string;
  floorNumber?: number;
  departmentId?: string;
  departmentLabel?: string;
  spot?: ParkingSpot;
  error?: string;
}

interface VehicleImportTower {
  id: string;
  code: string;
  floors: Array<{ floor_number: number; departments: Array<{ id: string; department_number: string; owner_name?: string | null }> }>;
}

interface VehicleImportError {
  line: number;
  license_plate: string;
  reason: string;
}

function parseVehicleCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, '');
  const firstLine = input.split(/\r?\n/).find(line => line.trim()) || '';
  const delimiterCounts = new Map([[',', 0], [';', 0], ['\t', 0]]);
  for (let i = 0; i < firstLine.length; i++) {
    if (firstLine[i] === '"') {
      if (inQuotes && firstLine[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && delimiterCounts.has(firstLine[i])) {
      delimiterCounts.set(firstLine[i], (delimiterCounts.get(firstLine[i]) || 0) + 1);
    }
  }
  const delimiter = [...delimiterCounts].sort((a, b) => b[1] - a[1])[0][0];
  inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(cells => cells.some(cell => cell.trim() !== ''));
}

function normalizePlate(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeSpotNumber(value: string): string {
  const raw = value.trim().replace(/^cochera\s*/i, '');
  if (!/^\d{1,3}$/.test(raw)) return '';
  const number = Number(raw);
  return number > 0 && number <= 999 ? String(number).padStart(3, '0') : '';
}

function normalizeImportedSpotType(value: string): ParkingSpotType | null {
  const normalized = value.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized === 'PROPIO' || normalized === 'VISITA' || normalized === 'ALQUILADO' ? normalized : null;
}

function normalizeImportedCocheraType(value: string): CocheraType | null {
  const normalized = value.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (normalized === 'INDIVIDUAL' || normalized === 'I') return 'INDIVIDUAL';
  if (normalized === 'MULTIPLE' || normalized === 'MULTIPLES' || normalized === 'M') return 'MULTIPLE';
  return null;
}

// Formato del departamento: T<torre>-<departamento> (el piso ya va en el número).
function deptLabelV(departments?: { department_number?: string; towers?: { code?: string } }): string {
  if (!departments?.department_number) return '-';
  const code = departments.towers?.code;
  if (!code) return departments.department_number;
  return `${/^T/i.test(code) ? code : `T${code}`}-${departments.department_number}`;
}

export function ParkingVehiclesTab({ schemaName }: { schemaName?: string }) {
  const { listVehicles, createVehicle, updateVehicle, deleteVehicle, deleteVehicles, setVehicleActive, listSpots } = useParking();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [spots, setSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [vehicleForm, setVehicleForm] = useState(emptyVehicleForm);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [togglingVehicleIds, setTogglingVehicleIds] = useState<Set<string>>(new Set());
  const [showVehicleForm, setShowVehicleForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showVehicleImport, setShowVehicleImport] = useState(false);
  const [vehicleImportFile, setVehicleImportFile] = useState('');
  const [vehicleImportRows, setVehicleImportRows] = useState<VehicleImportRow[]>([]);
  const [vehicleImportError, setVehicleImportError] = useState<string | null>(null);
  const [validatingVehicleImport, setValidatingVehicleImport] = useState(false);
  const [importingVehicles, setImportingVehicles] = useState(false);
  const [vehicleImportSummary, setVehicleImportSummary] = useState<{ created: number; updated?: number; spots_configured: number; errors: VehicleImportError[] } | null>(null);
  const vehicleImportInputRef = useRef<HTMLInputElement>(null);

  const [spotId, setSpotId] = useState('');
  const [deptId, setDeptId] = useState('');
  const [spotSearch, setSpotSearch] = useState('');
  const [spotDropdownOpen, setSpotDropdownOpen] = useState(false);
  const spotPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (spotPickerRef.current && !spotPickerRef.current.contains(e.target as Node)) {
        setSpotDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const [towers, setTowers] = useState<Tower[]>([]);

  const [vehPage, setVehPage] = useState(1);
  const [vehPerPage, setVehPerPage] = useState<number | 'all'>(10);

  const [plateFilter, setPlateFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [filterTowerId, setFilterTowerId] = useState('');
  const [filterFloorId, setFilterFloorId] = useState('');
  const [filterDeptId, setFilterDeptId] = useState('');
  const [filterFloors, setFilterFloors] = useState<Floor[]>([]);
  const [filterDepartments, setFilterDepartments] = useState<Department[]>([]);

  const load = useCallback(async () => {
    if (!schemaName) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const [ve, sp] = await Promise.all([listVehicles(schemaName), listSpots(schemaName)]);
      setVehicles(ve);
      setSpots(sp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar');
    } finally {
      setLoading(false);
    }
  }, [schemaName, listVehicles, listSpots]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setVehPage(1); }, [vehicles.length]);
  useEffect(() => { setVehPage(1); }, [plateFilter, driverFilter, onlyIncomplete, filterTowerId, filterFloorId, filterDeptId]);

  const loadTowers = useCallback(async () => {
    if (!schemaName) return;
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Tower[] | null }>('towers', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName }
      });
      setTowers((data?.data || []).sort((a, b) => a.code.localeCompare(b.code)));
    } catch {}
  }, [schemaName]);

  useEffect(() => { void loadTowers(); }, [loadTowers]);

  const selectSpot = (id: string) => {
    setSpotId(id);
    const sp = spots.find(s => s.id === id);
    setDeptId(sp?.department_id || '');
    setSpotSearch(sp ? `Cochera ${sp.spot_number}` : '');
    setSpotDropdownOpen(false);
    // Conductor por defecto: el propietario del departamento dueño de la cochera.
    const owner = sp?.departments?.owner_name;
    if (owner && !vehicleForm.driver_name.trim()) {
      setVehicleForm(prev => prev.driver_name.trim() ? prev : { ...prev, driver_name: owner });
    }
  };

  const assignedSpots = spots.filter(s => s.department_id);
  const spotQuery = spotSearch.trim().toLowerCase();
  const filteredSpots = spotQuery
    ? assignedSpots.filter(s => s.spot_number.toLowerCase().includes(spotQuery) || String(s.spot_row ?? '').includes(spotQuery))
    : assignedSpots;

  const loadFilterFloors = async (tid: string) => {
    if (!schemaName) return;
    setFilterFloors([]);
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterDepartments([]);
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Floor[] | null }>('floors', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: tid }
      });
      setFilterFloors((data?.data || []).sort((a, b) => a.floor_number - b.floor_number));
    } catch {}
  };

  const loadFilterDepartments = async (fid: string) => {
    if (!schemaName || !filterTowerId) return;
    setFilterDepartments([]);
    setFilterDeptId('');
    try {
      const { data } = await invokeFunction<{ success: boolean; data: Department[] | null }>('departments', {
        method: 'POST',
        body: { action: 'list', schema_name: schemaName, tower_id: filterTowerId, floor_id: fid }
      });
      setFilterDepartments((data?.data || []).sort((a, b) => a.department_number.localeCompare(b.department_number)));
    } catch {}
  };

  const selectFilterTower = (id: string) => {
    setFilterTowerId(id);
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterDepartments([]);
    void loadFilterFloors(id);
  };

  const selectFilterFloor = (id: string) => {
    setFilterFloorId(id);
    setFilterDeptId('');
    void loadFilterDepartments(id);
  };

  const clearFilters = () => {
    setPlateFilter('');
    setDriverFilter('');
    setOnlyIncomplete(false);
    setFilterTowerId('');
    setFilterFloorId('');
    setFilterDeptId('');
    setFilterFloors([]);
    setFilterDepartments([]);
    setVehPage(1);
  };

  const handleVehicleSave = async () => {
    if (!schemaName || !vehicleForm.license_plate.trim()) { alert('Indica la placa'); return; }
    if (!editingVehicle && !deptId) { alert('Selecciona la cochera del vehículo'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        license_plate: vehicleForm.license_plate.trim().toUpperCase(),
        vehicle_type: vehicleForm.vehicle_type,
        driver_name: vehicleForm.driver_name.trim() || null,
        brand: vehicleForm.brand.trim() || null,
        model: vehicleForm.model.trim() || null,
        color: vehicleForm.color.trim() || null
      };
      if (editingVehicle) {
        await updateVehicle(schemaName, editingVehicle.id, { ...payload, spot_id: spotId || null });
        setMessage('Vehículo actualizado');
      } else {
        await createVehicle(schemaName, { ...payload, department_id: deptId, spot_id: spotId || null });
        setMessage('Vehículo registrado a la cochera seleccionada');
      }
      setVehicleForm(emptyVehicleForm);
      setEditingVehicle(null);
      setShowVehicleForm(false);
      setSpotId('');
      setSpotSearch('');
      setDeptId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const startVehicleEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setVehicleForm({ license_plate: v.license_plate, vehicle_type: v.vehicle_type || 'AUTO', driver_name: v.driver_name || '', brand: v.brand || '', model: v.model || '', color: v.color || '' });
    setSpotId(v.spot_id || '');
    setSpotSearch(v.assigned_spot ? `Cochera ${v.assigned_spot}` : '');
    setDeptId('');
    setShowVehicleForm(true);
  };

  const closeForm = () => {
    setShowVehicleForm(false);
    setEditingVehicle(null);
    setVehicleForm(emptyVehicleForm);
    setSpotId('');
    setSpotSearch('');
    setDeptId('');
  };

  const handleToggleVehicleActive = async (v: Vehicle) => {
    if (!schemaName || togglingVehicleIds.has(v.id)) return;
    setError(null);
    setTogglingVehicleIds(prev => new Set(prev).add(v.id));
    try {
      const updated = await setVehicleActive(schemaName, v.id, !v.is_active);
      if (updated) setVehicles(prev => prev.map(x => (x.id === v.id ? updated : x)));
      setMessage(v.is_active ? 'Vehículo desactivado' : `Vehículo ${v.license_plate} activado`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar el estado');
    } finally {
      setTogglingVehicleIds(prev => { const next = new Set(prev); next.delete(v.id); return next; });
    }
  };

  const handleVehicleDelete = async (v: Vehicle) => {
    if (!schemaName) return;
    if (!confirm(`¿Eliminar el vehículo ${v.license_plate}?`)) return;
    try {
      await deleteVehicle(schemaName, v.id);
      setSelectedVehicleIds(current => {
        const next = new Set(current);
        next.delete(v.id);
        return next;
      });
      setMessage('Vehículo eliminado');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    }
  };

  const handleDeleteSelectedVehicles = async () => {
    if (!schemaName || selectedVehicleIds.size === 0) return;
    const selected = vehicles.filter(vehicle => selectedVehicleIds.has(vehicle.id));
    if (selected.length === 0) return;
    if (!confirm(`¿Eliminar ${selected.length} vehículo(s) seleccionado(s)? Se conservarán los historiales de acceso. Esta acción no se puede deshacer.`)) return;
    setDeletingSelected(true);
    setError(null);
    try {
      const deleted = await deleteVehicles(schemaName, selected.map(vehicle => vehicle.id));
      setSelectedVehicleIds(new Set());
      setMessage(`${deleted} vehículo(s) eliminado(s); se conservaron los historiales de acceso.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron eliminar los vehículos seleccionados.');
    } finally {
      setDeletingSelected(false);
    }
  };

  const openVehicleImport = () => {
    setVehicleImportFile('');
    setVehicleImportRows([]);
    setVehicleImportError(null);
    setVehicleImportSummary(null);
    if (vehicleImportInputRef.current) vehicleImportInputRef.current.value = '';
    setShowVehicleImport(true);
  };

  const downloadVehicleTemplate = () => {
    const link = document.createElement('a');
    link.href = '/plantilla-vehiculos.csv';
    link.download = 'plantilla-vehiculos.csv';
    link.click();
  };

  const handleVehicleImportFile = async (file: File | null) => {
    setVehicleImportError(null);
    setVehicleImportSummary(null);
    setVehicleImportRows([]);
    if (!file) return;
    setVehicleImportFile(file.name);
    setValidatingVehicleImport(true);
    try {
      const csvRows = parseVehicleCsv(await file.text());
      if (csvRows.length < 2) throw new Error('El CSV debe incluir encabezados y al menos una fila de datos.');

      const normalizeHeader = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      type HeaderIndexes = { spot?: number; plate?: number; driver?: number; spotType?: number; cocheraType?: number; tower?: number; department?: number };
      const indexesFor = (headers: string[]): HeaderIndexes => {
        const indexes: HeaderIndexes = {};
        headers.forEach((header, index) => {
          const key = normalizeHeader(header);
          const compactKey = key.replace(/[^a-z0-9]/g, '');
          if (['cochera', 'estacionamiento', 'plaza', 'spot', 'numerocochera', 'nrocochera', 'nocochera', 'numeroplaza', 'nroplaza', 'plazaestacionamiento'].includes(compactKey)) indexes.spot = index;
          else if (['placa', 'matricula', 'patente', 'license plate', 'license_plate'].includes(key) || ['placaauto', 'placavehicular', 'placadelvehiculo', 'licenseplate'].includes(compactKey)) indexes.plate = index;
          else if (['conductor', 'chofer', 'responsable', 'driver', 'nombreconductor', 'nombredelconductor', 'conductornombre'].includes(compactKey) || compactKey.startsWith('conductor')) indexes.driver = index;
          else if (['tipo-plaza', 'tipo de plaza', 'tipo plaza'].includes(key)) indexes.spotType = index;
          else if (['tipo-cochera', 'tipo de cochera', 'tipo cochera'].includes(key)) indexes.cocheraType = index;
          else if (['torre', 'codigo de torre', 'nombre corto'].includes(key) || ['codigotorre', 'torrecodigo', 'torreedificio'].includes(compactKey) || compactKey.startsWith('torre')) indexes.tower = index;
          else if (['departamento', 'dpto', 'depto', 'numero de departamento'].includes(key) || ['departamento', 'departamentodestino', 'numerodepartamento', 'numerodpto', 'dpto', 'depto', 'unidad'].includes(compactKey) || compactKey.startsWith('departamento')) indexes.department = index;
        });
        return indexes;
      };
      let headerRowIndex = 0;
      let indexes: HeaderIndexes = {};
      let bestHeaderScore = -1;
      for (let index = 0; index < Math.min(csvRows.length, 6); index++) {
        const candidate = indexesFor(csvRows[index]);
        const score = [candidate.spot, candidate.plate, candidate.tower, candidate.department].filter(value => value !== undefined).length;
        if (score > bestHeaderScore) {
          headerRowIndex = index;
          indexes = candidate;
          bestHeaderScore = score;
        }
        if (score === 4) break;
      }
      if (indexes.spot === undefined || indexes.plate === undefined || indexes.tower === undefined || indexes.department === undefined) {
        const headers = csvRows[headerRowIndex].join(' | ');
        throw new Error(`No se encontraron las columnas Cochera, Placa, Torre y Departamento. Encabezados detectados: ${headers}`);
      }

      if (!schemaName) throw new Error('No hay un condominio activo.');
      const { data: structure, error: structureError } = await invokeFunction<{
        success: boolean;
        data: VehicleImportTower[] | null;
        error: { message: string } | null;
      }>('tower-structure', { method: 'POST', body: { action: 'list', schema_name: schemaName } });
      if (structureError) throw structureError;
      if (!structure?.success || !structure.data) throw new Error(structure?.error?.message || 'No se pudo cargar la estructura del condominio.');
      const importTowers = structure.data;

      const parsedRows: VehicleImportRow[] = csvRows.slice(headerRowIndex + 1).map((cells, index) => {
        const valueAt = (column?: number) => column === undefined ? '' : (cells[column] || '').trim();
        const rawSpotNumber = valueAt(indexes.spot);
        const spotNumber = normalizeSpotNumber(rawSpotNumber);
        const licensePlate = valueAt(indexes.plate).toUpperCase();
        const driverName = valueAt(indexes.driver);
        const rawSpotType = valueAt(indexes.spotType);
        const rawCocheraType = valueAt(indexes.cocheraType);
        const spotType = rawSpotType ? normalizeImportedSpotType(rawSpotType) : 'PROPIO';
        const cocheraType = rawCocheraType ? normalizeImportedCocheraType(rawCocheraType) : 'MULTIPLE';
        const towerCode = valueAt(indexes.tower);
        const departmentNumber = valueAt(indexes.department).replace(/\s/g, '');
        const entry: VehicleImportRow = { line: index + headerRowIndex + 2, spotNumber, licensePlate, driverName, spotType: spotType || 'PROPIO', cocheraType: cocheraType || 'MULTIPLE', towerCode, departmentNumber };
        if (!rawSpotNumber || !towerCode || !departmentNumber) {
          entry.error = 'Falta la cochera, torre o departamento.';
          return entry;
        }
        if (!spotNumber) {
          entry.error = 'La cochera debe ser un número entre 1 y 999.';
          return entry;
        }
        if (licensePlate && !normalizePlate(licensePlate)) {
          entry.error = 'La placa no contiene letras o números válidos.';
          return entry;
        }
        if (!spotType) {
          entry.error = `El tipo de plaza ${rawSpotType} no es válido.`;
          return entry;
        }
        if (!cocheraType) {
          entry.error = `El tipo de cochera ${rawCocheraType} no es válido.`;
          return entry;
        }
        if (!/^\d{3,}$/.test(departmentNumber)) {
          entry.error = 'El departamento debe ser un número de al menos 3 cifras.';
          return entry;
        }

        const towerMatches = importTowers.filter(tower => tower.code.trim().toLowerCase() === towerCode.toLowerCase());
        if (towerMatches.length !== 1) {
          entry.error = towerMatches.length === 0 ? `No existe la torre ${towerCode}.` : `Hay más de una torre con el nombre corto ${towerCode}.`;
          return entry;
        }
        const floorNumber = Number(departmentNumber.slice(0, -2));
        if (!Number.isInteger(floorNumber) || floorNumber < 1) {
          entry.error = `No se pudo obtener el piso del departamento ${departmentNumber}.`;
          return entry;
        }
        entry.floorNumber = floorNumber;
        const floor = towerMatches[0].floors.find(candidate => candidate.floor_number === floorNumber);
        if (!floor) {
          entry.error = `La torre ${towerCode} no tiene el piso ${floorNumber}.`;
          return entry;
        }
        const exactDepartments = floor.departments.filter(department => department.department_number.trim() === departmentNumber);
        const numberDepartments = floor.departments.filter(department => /^\d+$/.test(department.department_number) && Number(department.department_number) === Number(departmentNumber));
        const departments = exactDepartments.length > 0 ? exactDepartments : numberDepartments;
        if (departments.length !== 1) {
          entry.error = departments.length === 0
            ? `No existe el departamento ${departmentNumber} en la torre ${towerCode}.`
            : `El departamento ${departmentNumber} es ambiguo en la torre ${towerCode}.`;
          return entry;
        }
        entry.departmentId = departments[0].id;
        entry.departmentLabel = `${/^T/i.test(towerCode) ? towerCode : `T${towerCode}`}-${departments[0].department_number}`;
        if (entry.licensePlate && !entry.driverName) {
          // Conductor por defecto: el propietario del departamento (puede quedar vacío).
          entry.driverName = departments[0].owner_name?.trim() || '';
        }

        const spotMatches = spots.filter(candidate => normalizeSpotNumber(candidate.spot_number) === spotNumber);
        if (spotMatches.length !== 1) {
          entry.error = spotMatches.length === 0 ? `No existe la cochera ${spotNumber}.` : `Hay más de una cochera ${spotNumber}.`;
          return entry;
        }
        if (spotMatches[0].inside && (
          spotMatches[0].department_id !== entry.departmentId ||
          spotMatches[0].type !== spotType ||
          (spotMatches[0].cochera_type || 'MULTIPLE') !== cocheraType
        )) {
          entry.error = `La cochera ${spotNumber} está ocupada y no se puede reasignar ni cambiar de tipo.`;
          return entry;
        }
        entry.spot = spotMatches[0];
        return entry;
      });

      const seenPlates = new Set<string>();
      const spotConfigurations = new Map<string, string>();
      for (const row of parsedRows) {
        if (row.error) continue;
        const spotConfig = `${row.departmentId}:${row.spotType}:${row.cocheraType}`;
        const currentSpotConfig = spotConfigurations.get(row.spot!.id);
        if (currentSpotConfig && currentSpotConfig !== spotConfig) {
          row.error = `La cochera ${row.spotNumber} tiene asignaciones o tipos distintos en el archivo.`;
          continue;
        }
        spotConfigurations.set(row.spot!.id, spotConfig);
        if (!row.licensePlate) continue;
        const key = normalizePlate(row.licensePlate);
        const existingVehicle = vehicles.find(vehicle => normalizePlate(vehicle.license_plate) === key);
        if (existingVehicle?.spot_id && existingVehicle.spot_id !== row.spot!.id) {
          row.error = `La placa ${row.licensePlate} ya está asignada a la cochera ${existingVehicle.assigned_spot || 'otra'}. Quita esa asignación antes de reasignarla.`;
          continue;
        }
        if (seenPlates.has(key)) {
          row.error = `La placa ${row.licensePlate} está repetida en el archivo.`;
          continue;
        }
        seenPlates.add(key);
      }
      setVehicleImportRows(parsedRows);
    } catch (err) {
      setVehicleImportError(err instanceof Error ? err.message : 'No se pudo leer o validar el CSV.');
    } finally {
      setValidatingVehicleImport(false);
    }
  };

  const handleImportVehicles = async () => {
    const readyRows = vehicleImportRows.filter(row => !row.error && row.spot);
    if (!schemaName || readyRows.length === 0) {
      setVehicleImportError(readyRows.length === 0 ? 'No hay filas válidas para importar.' : 'No hay un condominio activo.');
      return;
    }

    setImportingVehicles(true);
    setVehicleImportError(null);
    setVehicleImportSummary(null);
    try {
      const { data, error: functionError } = await invokeFunction<{
        success: boolean;
        data: { created: number; updated?: number; spots_configured: number; errors: VehicleImportError[] } | null;
        error: { message: string } | null;
      }>('parking-control', {
        method: 'POST',
        body: {
          action: 'import-vehicles',
          schema_name: schemaName,
          items: readyRows.map(row => ({
            line: row.line,
            spot_number: row.spotNumber,
            spot_id: row.spot?.id,
            license_plate: row.licensePlate,
            driver_name: row.driverName,
            spot_type: row.spotType,
            cochera_type: row.cocheraType,
            tower_code: row.towerCode,
            department_number: row.departmentNumber
          }))
        }
      });
      if (functionError) throw functionError;
      if (!data?.success || !data.data) throw new Error(data?.error?.message || 'No se pudieron importar los vehículos.');
      setVehicleImportSummary(data.data);
      const errorsByLine = new Map(data.data.errors.map(item => [item.line, item.reason]));
      setVehicleImportRows(current => current.map(row => errorsByLine.has(row.line) ? { ...row, error: errorsByLine.get(row.line) } : row));
      await load();
    } catch (err) {
      setVehicleImportError(err instanceof Error ? err.message : 'Error al importar vehículos.');
    } finally {
      setImportingVehicles(false);
    }
  };

  if (loading) return <div className="loading-message">Cargando vehículos...</div>;

  const qPlate = plateFilter.trim().toLowerCase();
  const qDriver = driverFilter.trim().toLowerCase();
  const filterFloorNumber = filterFloors.find(f => f.id === filterFloorId)?.floor_number;
  const filteredVehicles = vehicles.filter(v => {
    if (qPlate && !v.license_plate.toLowerCase().includes(qPlate)) return false;
    if (qDriver && !(v.driver_name || '').toLowerCase().includes(qDriver)) return false;
    if (onlyIncomplete && Boolean(v.driver_name?.trim()) && Boolean(v.departments?.department_number) && Boolean(v.occupied_spot || v.departments?.spots?.length)) return false;
    if (filterTowerId && v.departments?.towers?.id !== filterTowerId) return false;
    if (filterFloorId && v.departments?.floor_number != null && v.departments.floor_number !== filterFloorNumber) return false;
    if (filterDeptId && v.department_id !== filterDeptId) return false;
    return true;
  });

  const vehPageItems = vehPerPage === 'all' ? filteredVehicles : paginate(filteredVehicles, vehPage, vehPerPage).slice;

  return (
    <div>
      <div className="panel-header">
        <div>
          <h3>Vehículos registrados</h3>
          <small>Registra los vehículos de cada departamento para validar su ingreso/salida en garita.</small>
        </div>
        {!showVehicleForm && (
          <div className="parking-vehicle-header-actions">
            <button onClick={openVehicleImport}><span className="material-symbols-outlined">upload_file</span> Importar CSV</button>
            <button onClick={() => { setShowVehicleForm(true); setEditingVehicle(null); setVehicleForm(emptyVehicleForm); setSpotId(''); setSpotSearch(''); setDeptId(''); }}>
              <span className="material-symbols-outlined">directions_car</span> Adicionar vehículo
            </button>
          </div>
        )}
      </div>

      {message && <div className="success-message" onClick={() => setMessage(null)}>{message} — clic para cerrar</div>}
      {error && <div className="error-message" onClick={() => setError(null)}>{error} — clic para cerrar</div>}

      {filteredVehicles.length > 0 && (
        <div className="parking-vehicle-selection">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={filteredVehicles.every(vehicle => selectedVehicleIds.has(vehicle.id))}
              onChange={event => setSelectedVehicleIds(current => {
                const next = new Set(current);
                if (event.target.checked) filteredVehicles.forEach(vehicle => next.add(vehicle.id));
                else filteredVehicles.forEach(vehicle => next.delete(vehicle.id));
                return next;
              })}
            />
            <span>Seleccionar todos los resultados ({filteredVehicles.length})</span>
          </label>
          <div className="history-tools-actions">
            {selectedVehicleIds.size > 0 && <span>{selectedVehicleIds.size} seleccionado(s)</span>}
            <button className="btn-cancel users-bulk-delete" onClick={() => void handleDeleteSelectedVehicles()} disabled={deletingSelected || selectedVehicleIds.size === 0}>
              {deletingSelected ? <span className="spinner spinner-inline" /> : <span className="material-symbols-outlined">delete</span>}
              {deletingSelected ? 'Eliminando...' : 'Eliminar seleccionados'}
            </button>
          </div>
        </div>
      )}

      {showVehicleImport && (
        <div className="modal-overlay" onClick={() => !importingVehicles && !validatingVehicleImport && setShowVehicleImport(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Importar vehículos desde CSV</h3>
                <p className="text-on-surface-variant">Primero se asigna y configura cada cochera para su torre y departamento; después se importan las placas. El tipo de vehículo inicial será Auto.</p>
              </div>
              <button className="modal-close" onClick={() => !importingVehicles && !validatingVehicleImport && setShowVehicleImport(false)} title="Cerrar" disabled={importingVehicles || validatingVehicleImport}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Archivo CSV</label>
                <input
                  ref={vehicleImportInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={validatingVehicleImport || importingVehicles}
                  onChange={e => void handleVehicleImportFile(e.target.files?.[0] || null)}
                />
                <small>Columnas requeridas: Cochera, Tipo-Plaza, Tipo-Cochera, Torre y Departamento. La Placa es opcional: si falta, solo se asigna la cochera al departamento. El conductor se obtiene del propietario del departamento. Se aceptan CSV separados por coma o punto y coma.</small>
                <button type="button" className="btn-cancel" style={{ display: 'inline-flex', gap: '0.3rem', marginTop: '0.5rem' }} onClick={downloadVehicleTemplate}>
                  <span className="material-symbols-outlined">download</span> Descargar plantilla
                </button>
              </div>

              {vehicleImportFile && (
                <div className="import-summary">
                  <span className="material-symbols-outlined">description</span>
                  <span><strong>{vehicleImportFile}</strong> — {vehicleImportRows.filter(row => !row.error && row.spot).length} válida(s), {vehicleImportRows.filter(row => row.error).length} omitida(s)</span>
                </div>
              )}

              {(validatingVehicleImport || importingVehicles) && (
                <div className="import-loader">
                  <div className="import-loader-spinner" aria-hidden="true" />
                  <div className="import-loader-text"><strong>{validatingVehicleImport ? 'Validando cocheras y placas...' : 'Importando vehículos...'}</strong></div>
                </div>
              )}

              {vehicleImportError && <div className="error-message">{vehicleImportError}</div>}

              {vehicleImportRows.some(row => row.error) && (
                <div className="import-invalid-details">
                  <div className="import-invalid-title">
                    <span className="material-symbols-outlined">warning</span>
                    <strong>Filas que no se importarán ({vehicleImportRows.filter(row => row.error).length})</strong>
                  </div>
                  <ul>
                    {vehicleImportRows.filter(row => row.error).slice(0, 20).map(row => (
                      <li key={row.line}><code>Fila {row.line}</code><span className="import-invalid-email">{row.licensePlate || '(sin placa)'}</span><span>— {row.error}</span></li>
                    ))}
                    {vehicleImportRows.filter(row => row.error).length > 20 && <li>… y {vehicleImportRows.filter(row => row.error).length - 20} más</li>}
                  </ul>
                </div>
              )}

              {vehicleImportRows.some(row => !row.error && row.spot) && (
                <div className="import-preview">
                  <table>
                    <thead><tr><th>Fila</th><th>Cochera</th><th>Tipo plaza</th><th>Tipo cochera</th><th>Departamento destino</th><th>Placa</th><th>Conductor</th></tr></thead>
                    <tbody>
                      {vehicleImportRows.filter(row => !row.error && row.spot).slice(0, 10).map(row => (
                        <tr key={row.line}>
                          <td>{row.line}</td>
                          <td>{row.spotNumber}</td>
                          <td>{row.spotType}</td>
                          <td>{row.cocheraType}</td>
                          <td>{row.departmentLabel || '-'}</td>
                          <td>{row.licensePlate || 'Sin placa'}</td>
                          <td>{row.driverName || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {vehicleImportRows.filter(row => !row.error && row.spot).length > 10 && <div className="import-preview-more">… y {vehicleImportRows.filter(row => !row.error && row.spot).length - 10} más</div>}
                </div>
              )}

              {vehicleImportSummary && (
                <div className="import-result">
                  <div className="import-result-summary">
                    <div className="import-result-count"><span className="material-symbols-outlined">check_circle</span><span><strong>{vehicleImportSummary.created}</strong> vehículo(s) importado(s)</span></div>
                    {Boolean(vehicleImportSummary.updated) && <div className="import-result-count"><span className="material-symbols-outlined">sync</span><span><strong>{vehicleImportSummary.updated}</strong> vehículo(s) actualizado(s)</span></div>}
                    <div className="import-result-count"><span className="material-symbols-outlined">local_parking</span><span><strong>{vehicleImportSummary.spots_configured}</strong> cochera(s) configurada(s)</span></div>
                    {vehicleImportSummary.errors.length > 0 && <div className="import-result-count"><span className="material-symbols-outlined">error</span><span><strong>{vehicleImportSummary.errors.length}</strong> fila(s) omitida(s)</span></div>}
                  </div>
                  {vehicleImportSummary.errors.length > 0 && <ul className="import-result-errors">{vehicleImportSummary.errors.slice(0, 20).map((item, index) => <li key={index}>Fila {item.line} ({item.license_plate}): {item.reason}</li>)}</ul>}
                </div>
              )}

              <div className="form-actions">
                <button className="btn-cancel" onClick={() => setShowVehicleImport(false)} disabled={importingVehicles || validatingVehicleImport}>Cerrar</button>
                <button
                  onClick={() => void handleImportVehicles()}
                  disabled={validatingVehicleImport || importingVehicles || Boolean(vehicleImportSummary) || !vehicleImportRows.some(row => !row.error && row.spot)}
                >
                  <span className="material-symbols-outlined">upload_file</span>
                  {importingVehicles ? 'Importando...' : 'Importar vehículos'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showVehicleForm && (
        <div className="modal-overlay" onClick={closeForm}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>{editingVehicle ? 'Editar vehículo' : 'Registrar vehículo'}</h3>
                <p className="text-on-surface-variant">{editingVehicle ? 'Solo editas los datos del vehículo.' : 'Selecciona la cochera a la que pertenece el vehículo (el departamento se carga de la cochera).'}</p>
              </div>
              <button className="modal-close" onClick={closeForm} title="Cerrar"><span className="material-symbols-outlined">close</span></button>
            </div>
            <div className="modal-body">

          <p className="cart-checkout-hint">
            {editingVehicle
              ? `Vehículo de ${deptLabelV(editingVehicle.departments)}. Puedes cambiar la cochera asignada; el departamento se toma de la cochera.`
              : 'Busca y selecciona la cochera del vehículo. El departamento se toma de la cochera y el nombre del conductor se rellena por defecto con el propietario de la cochera (puedes cambiarlo).'}
          </p>

          <div className="form-group">
            <label>Cochera del vehículo</label>
            <div className="search-bar condo-picker" ref={spotPickerRef}>
              <input
                type="text"
                value={spotSearch}
                placeholder="Buscar cochera (ej. 01, 3)..."
                autoFocus
                onFocus={() => setSpotDropdownOpen(true)}
                onChange={e => { setSpotSearch(e.target.value); setSpotDropdownOpen(true); }}
              />
              {spotDropdownOpen && !(spotQuery === '' && filteredSpots.length === 0) && (
                <div className="condo-picker-dropdown">
                  {filteredSpots.length === 0 ? (
                    <div className="condo-picker-empty">Sin resultados</div>
                  ) : (
                    filteredSpots.map(s => (
                      <button key={s.id} type="button" className={`condo-picker-item ${spotId === s.id ? 'selected' : ''}`} onClick={() => selectSpot(s.id)}>
                        <span className="material-symbols-outlined">local_parking</span>
                        <span>Cochera {s.spot_number}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {assignedSpots.length === 0 && (
              <small className="text-muted">No hay cocheras asignadas a departamentos. Primero asigna la cochera a un departamento en la configuración del estacionamiento.</small>
            )}
          </div>

          {spotId && (() => {
            const sp = spots.find(s => s.id === spotId);
            return sp?.department_id ? (
              <span className="checkout-hint-inline">Cochera {sp.spot_number} seleccionada.</span>
            ) : (
              <span className="checkout-hint-inline">Cochera sin departamento asignado.</span>
            );
          })()}

          <div className="form-group">
              <label>Tipo de vehículo</label>
              <select value={vehicleForm.vehicle_type} onChange={e => setVehicleForm({ ...vehicleForm, vehicle_type: e.target.value as VehicleType })}>
                {Object.entries(VEHICLE_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Placa</label>
              <input type="text" value={vehicleForm.license_plate} onChange={e => setVehicleForm({ ...vehicleForm, license_plate: e.target.value })} placeholder="ABC-123" />
            </div>
          <div className="form-row">
            <div className="form-group">
              <label>Conductor (dueño o responsable)</label>
              <input type="text" value={vehicleForm.driver_name} onChange={e => setVehicleForm({ ...vehicleForm, driver_name: e.target.value })} placeholder="Nombre de quien conduce normalmente" />
              <small className="text-muted">Se mostrará automáticamente en el registro de ingreso en garita.</small>
            </div>
            <div className="form-group"></div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Marca</label>
              <input type="text" value={vehicleForm.brand} onChange={e => setVehicleForm({ ...vehicleForm, brand: e.target.value })} placeholder="Toyota" />
            </div>
            <div className="form-group">
              <label>Modelo</label>
              <input type="text" value={vehicleForm.model} onChange={e => setVehicleForm({ ...vehicleForm, model: e.target.value })} placeholder="Corolla" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Color</label>
              <input type="text" value={vehicleForm.color} onChange={e => setVehicleForm({ ...vehicleForm, color: e.target.value })} placeholder="Rojo" />
            </div>
          </div>

          <div className="form-actions">
            <button className="btn-cancel" onClick={closeForm}>Cancelar</button>
            <button onClick={handleVehicleSave} disabled={saving}>{saving ? 'Guardando...' : editingVehicle ? 'Guardar' : 'Registrar'}</button>
          </div>
            </div>
          </div>
        </div>
      )}

      <div className="filter-bar">
        <div className="form-group">
          <label>Placa</label>
          <input type="text" value={plateFilter} onChange={e => setPlateFilter(e.target.value)} placeholder="ABC-123 o 123" />
        </div>
        <div className="form-group">
          <label>Conductor</label>
          <input type="text" value={driverFilter} onChange={e => setDriverFilter(e.target.value)} placeholder="Nombre" />
        </div>
        <div className="form-group">
          <label>Torre</label>
          <select value={filterTowerId} onChange={e => selectFilterTower(e.target.value)}>
            <option value="">Todas</option>
            {towers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Piso</label>
          <select value={filterFloorId} onChange={e => selectFilterFloor(e.target.value)} disabled={!filterTowerId}>
            <option value="">Todos</option>
            {filterFloors.map(f => <option key={f.id} value={f.id}>Piso {f.floor_number}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Departamento</label>
          <select value={filterDeptId} onChange={e => setFilterDeptId(e.target.value)} disabled={!filterFloorId}>
            <option value="">Todos</option>
            {filterDepartments.map(d => <option key={d.id} value={d.id}>{d.department_number}</option>)}
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn-cancel" onClick={clearFilters}>Limpiar</button>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={onlyIncomplete} onChange={event => setOnlyIncomplete(event.target.checked)} />
          <span>Solo registros incompletos</span>
        </label>
      </div>

      <div className="parking-vehicles-count">
        Mostrando <strong>{vehPageItems.length}</strong> de <strong>{vehicles.length}</strong> vehículo(s)
        {filteredVehicles.length !== vehicles.length && <> · filtrados: <strong>{filteredVehicles.length}</strong></>}
      </div>

      {vehicles.length === 0 ? (
        <div className="empty-state"><p>No hay vehículos registrados.</p></div>
      ) : filteredVehicles.length === 0 ? (
        <div className="empty-state"><p>No hay vehículos que coincidan con los filtros.</p></div>
      ) : (
        <>
        <div className="parking-vehicles-table-wrap">
        <table className="residents-table residents-desktop parking-vehicles-table">
          <thead>
            <tr>
              <th aria-label="Seleccionar"></th>
              <th>Placa</th>
              <th>Vehículo</th>
              <th>Conductor</th>
              <th>Departamento</th>
              <th>Plaza</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vehPageItems.map(v => (
              <tr key={v.id}>
                <td><input type="checkbox" aria-label={`Seleccionar ${v.license_plate}`} checked={selectedVehicleIds.has(v.id)} onChange={event => setSelectedVehicleIds(current => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(v.id);
                  else next.delete(v.id);
                  return next;
                })} /></td>
                <td className="vehicle-license-plate"><strong>{v.license_plate}</strong></td>
                <td>{(VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type)}{(v.model || v.brand) ? ` · ${v.model || v.brand}` : ''}</td>
                <td>{v.driver_name || <span className="text-muted">Sin conductor</span>}</td>
                <td>{v.department_label || deptLabelV(v.departments)}</td>
                <td>{v.assigned_spot || v.occupied_spot || v.parking_spots?.join(', ') || v.departments?.spots?.join(', ') || '-'}</td>
                <td><span className={`status-badge ${v.is_active ? 'status-occupied' : 'status-vacant'}`}>{v.is_active ? 'Activo' : 'Inactivo'}</span></td>
                <td>
                  <div className="resident-row-actions">
                    <button className="icon-btn" onClick={() => handleToggleVehicleActive(v)} disabled={togglingVehicleIds.has(v.id)} title={v.is_active ? 'Desactivar' : 'Activar'}>{togglingVehicleIds.has(v.id) ? <span className="spinner spinner-inline" /> : <span className="material-symbols-outlined">{v.is_active ? 'toggle_on' : 'toggle_off'}</span>}</button>
                    <button className="icon-btn" onClick={() => startVehicleEdit(v)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                    <button className="icon-btn danger" onClick={() => handleVehicleDelete(v)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="residents-mobile-grid">
          {vehPageItems.map(v => (
            <div key={v.id} className="resident-grid-card">
              <div className="resident-grid-main">
                <label className="checkbox-row">
                  <input type="checkbox" aria-label={`Seleccionar ${v.license_plate}`} checked={selectedVehicleIds.has(v.id)} onChange={event => setSelectedVehicleIds(current => {
                    const next = new Set(current);
                    if (event.target.checked) next.add(v.id);
                    else next.delete(v.id);
                    return next;
                  })} />
                  <span className="resident-grid-name">{v.license_plate}</span>
                </label>
                <span className="resident-grid-meta">{VEHICLE_TYPE_LABELS[v.vehicle_type] || v.vehicle_type}{(v.model || v.brand) ? ` · ${v.model || v.brand}` : ''}</span>
              </div>
              <div className="resident-grid-fields">
                <div className="resident-grid-line"><span className="resident-grid-label">Conductor</span><span>{v.driver_name || '-'}</span></div>
                <div className="resident-grid-line"><span className="resident-grid-label">Departamento</span><span>{v.department_label || deptLabelV(v.departments)}</span></div>
                <div className="resident-grid-line"><span className="resident-grid-label">Plaza</span><span>{v.assigned_spot || v.occupied_spot || v.parking_spots?.join(', ') || v.departments?.spots?.join(', ') || '-'}</span></div>
                <div className="resident-grid-line"><span className="resident-grid-label">Estado</span><span>{v.is_active ? 'Activo' : 'Inactivo'}</span></div>
              </div>
              <div className="resident-row-actions">
                <button className="icon-btn" onClick={() => handleToggleVehicleActive(v)} disabled={togglingVehicleIds.has(v.id)} title={v.is_active ? 'Desactivar' : 'Activar'}>{togglingVehicleIds.has(v.id) ? <span className="spinner spinner-inline" /> : <span className="material-symbols-outlined">{v.is_active ? 'toggle_on' : 'toggle_off'}</span>}</button>
                    <button className="icon-btn" onClick={() => startVehicleEdit(v)} title="Editar"><span className="material-symbols-outlined">edit</span></button>
                <button className="icon-btn danger" onClick={() => handleVehicleDelete(v)} title="Eliminar"><span className="material-symbols-outlined">delete</span></button>
              </div>
            </div>
          ))}
        </div>
        </>
      )}
      <PaginationBar total={filteredVehicles.length} page={vehPage} perPage={vehPerPage} onPageChange={setVehPage} onPerPageChange={(n) => { setVehPerPage(n); setVehPage(1); }} itemLabel="vehículo" />
    </div>
  );
}
