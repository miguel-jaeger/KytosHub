import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { invokeFunction } from '../lib/insforge';

export const SUPER_ADMIN_EMAIL = 'miguel.jaeger@gmail.com';

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  SECURITY_AGENT: 'Agente de Seguridad',
  RESIDENT: 'Residente',
  VISITOR: 'Visitante'
};

export type UserRole = 'loading' | 'super' | 'admin' | 'resident' | 'none';

export function useUserRole(): UserRole {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<UserRole>('loading');

  useEffect(() => {
    if (loading || !user) { setRole('loading'); return; }
    if (user.email === SUPER_ADMIN_EMAIL) { setRole('super'); return; }

    let cancelled = false;
    invokeFunction<{ success: boolean; data: { role: string; status: string }[] | null }>('list-condominium-users', {
      method: 'POST',
      body: { action: 'list-by-user', user_id: user.id }
    }).then(({ data }) => {
      if (cancelled) return;
      if (data?.success && data.data) {
        const active = data.data.filter(x => x.status === 'ACTIVE');
        const highest = active.some(x => x.role === 'SUPER_ADMIN' || x.role === 'ADMIN');
        setRole(highest ? 'admin' : 'resident');
      } else {
        setRole('resident');
      }
    }).catch(() => { if (!cancelled) setRole('resident'); });

    return () => { cancelled = true; };
  }, [user, loading]);

  return role;
}

export function useRoleLabel(role: UserRole): string {
  if (role === 'super') return ROLE_LABELS.SUPER_ADMIN;
  if (role === 'admin') return ROLE_LABELS.ADMIN;
  if (role === 'resident') return ROLE_LABELS.RESIDENT;
  return 'Residente';
}