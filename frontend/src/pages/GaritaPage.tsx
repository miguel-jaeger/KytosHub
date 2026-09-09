import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useCondominium, type ActiveCondominium } from '../contexts/CondominiumContext';
import { useUserRole } from '../hooks/useUserRole';
import { invokeFunction } from '../lib/insforge';
import { GaritaManager } from '../modules/core/components/GaritaManager';

export function GaritaPage() {
  const { user } = useAuth();
  const role = useUserRole();
  const navigate = useNavigate();
  const { condominium: contextCondo, setCondominium } = useCondominium();
  const [available, setAvailable] = useState<ActiveCondominium[]>([]);
  const [resolved, setResolved] = useState<ActiveCondominium | null>(null);
  const [loading, setLoading] = useState(true);
  const initialContextRef = useRef<ActiveCondominium | null>(contextCondo);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) { setLoading(false); return; }
      setLoading(true);
      try {
        const { data } = await invokeFunction<{ success: boolean; data: { tenant_id: string; role: string; status: string }[] | null }>('list-condominium-users', {
          method: 'POST',
          body: { action: 'list-by-user', user_id: user.id }
        });
        const active = (data?.data || []).filter(x => x.status === 'ACTIVE' && (x.role === 'SECURITY_AGENT' || x.role === 'ADMIN' || x.role === 'SUPER_ADMIN'));
        const condos: ActiveCondominium[] = [];
        for (const act of active) {
          const { data: condo } = await invokeFunction<{ success: boolean; data: { id: string; name: string; slug: string; short_name: string | null; schema_name: string; image_url: string | null } | null }>('list-condominiums', {
            method: 'POST',
            body: { action: 'list', id: act.tenant_id }
          });
          const c = condo?.data;
          if (c) {
            condos.push({
              tenant_id: c.id,
              name: c.name,
              slug: c.slug,
              short_name: c.short_name || c.slug,
              schema_name: c.schema_name,
              image_url: c.image_url
            });
          }
        }
        if (cancelled) return;
        setAvailable(condos);
        if (condos.length > 0) {
          const preferred = condos.find(c => c.tenant_id === initialContextRef.current?.tenant_id) || condos[0];
          setResolved(preferred);
        } else {
          setResolved(null);
        }
      } catch {
        if (!cancelled) setResolved(initialContextRef.current);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  useEffect(() => {
    if (role === 'loading') return;
    if (role !== 'security' && role !== 'admin' && role !== 'super') {
      navigate('/', { replace: true });
    }
  }, [role, navigate]);

  if (role === 'loading' || loading) return <div className="loading-message">Cargando garita...</div>;
  if (role !== 'security' && role !== 'admin' && role !== 'super') return null;

  const active = resolved ?? contextCondo;

  if (!active && available.length === 0) {
    return (
      <div className="dashboard">
        <div className="header"><h2>Panel de Garita</h2></div>
        <div className="empty-state"><p>No tienes un condominio asignado para operar la garita.</p></div>
      </div>
    );
  }

  const handleSelect = (tenantId: string) => {
    const selected = available.find(c => c.tenant_id === tenantId);
    if (selected) {
      setResolved(selected);
      setCondominium(selected);
    }
  };

  return (
    <div className="dashboard">
      <div className="header">
        <h2>Panel de Garita</h2>
        {available.length > 1 && (
          <select
            style={{ marginLeft: 'auto', padding: '0.4rem 0.6rem', borderRadius: 8, border: '1px solid #c6c6cd' }}
            value={active?.tenant_id || ''}
            onChange={e => handleSelect(e.target.value)}
          >
            {available.map(c => <option key={c.tenant_id} value={c.tenant_id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {active && <GaritaManager schemaName={active.schema_name} />}
    </div>
  );
}