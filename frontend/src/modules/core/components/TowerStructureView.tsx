import { useState } from 'react';
import { useTowerStructure } from '../hooks/useTowerStructure';
import type { TowerNode, DepartmentNode } from '../types';

const statusLabel: Record<DepartmentNode['status'], string> = {
  HABITADO: 'Habitado',
  DESOCUPADO: 'Desocupado',
  MANTENIMIENTO: 'En mantenimiento'
};

const statusClass: Record<DepartmentNode['status'], string> = {
  HABITADO: 'status-occupied',
  DESOCUPADO: 'status-vacant',
  MANTENIMIENTO: 'status-maintenance'
};

export function TowerStructureView() {
  const { towers, loading, error, refresh } = useTowerStructure();
  const [expandedTowers, setExpandedTowers] = useState<Set<string>>(new Set());
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());

  const toggleTower = (id: string) => {
    setExpandedTowers(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleFloor = (id: string) => {
    setExpandedFloors(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const totalDepartments = (tower: TowerNode) =>
    tower.floors.reduce((sum, floor) => sum + floor.departments.length, 0);

  if (loading) return <div className="loading-message">Cargando estructura...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="tower-structure">
      <div className="header">
        <h2>Estructura del Condominio</h2>
        <button onClick={refresh}>Actualizar</button>
      </div>

      {towers.length === 0 ? (
        <div className="empty-state">
          <p>No hay torres registradas.</p>
          <p>Use el asistente de configuración para crear la estructura inicial.</p>
        </div>
      ) : (
        <div className="tower-list">
          {towers.map(tower => {
            const isTowerOpen = expandedTowers.has(tower.id);
            return (
              <div key={tower.id} className="tower-card">
                <div className="tower-header" onClick={() => toggleTower(tower.id)}>
                  <span className="tower-icon">{isTowerOpen ? '▼' : '▶'}</span>
                  <div className="tower-info">
                    <h3>{tower.name}</h3>
                    <span className="tower-code">Código: {tower.code}</span>
                  </div>
                  <div className="tower-stats">
                    <span>{tower.floors.length} pisos</span>
                    <span>{totalDepartments(tower)} departamentos</span>
                  </div>
                </div>

                {isTowerOpen && (
                  <div className="floor-list">
                    {tower.floors.map(floor => {
                      const isFloorOpen = expandedFloors.has(floor.id);
                      return (
                        <div key={floor.id} className="floor-card">
                          <div className="floor-header" onClick={() => toggleFloor(floor.id)}>
                            <span className="floor-icon">{isFloorOpen ? '▼' : '▶'}</span>
                            <span className="floor-label">Piso {floor.floor_number}</span>
                            <span className="floor-count">{floor.departments.length} deptos</span>
                          </div>

                          {isFloorOpen && (
                            <div className="department-grid">
                              {floor.departments.map(dept => (
                                <div key={dept.id} className="department-card">
                                  <span className="department-number">Depto {dept.department_number}</span>
                                  <span className={`status-badge ${statusClass[dept.status]}`}>
                                    {statusLabel[dept.status]}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}