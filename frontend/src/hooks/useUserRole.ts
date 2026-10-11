import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { invokeFunction } from '../lib/insforge';

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Administrador',
  SECURITY_AGENT: 'Agente de Seguridad',
  SUPERVISOR: 'Supervisor',
  RESIDENT: 'Residente',
  VISITOR: 'Visitante'
};

export type UserRole = 'loading' | 'super' | 'admin' | 'security' | 'resident' | 'none';

export function useUserRole(): UserRole {
  const { user, loading } = useAuth();
  const [role, setRole] = useState<UserRole>('loading');

  useEffect(() => {
    if (loading) { setRole('loading'); return; }
    if (!user) { setRole('none'); return; }

    let cancelled = false;
    invokeFunction<{ success: boolean; data: { role: string } | null }>('list-condominium-users', {
      method: 'POST',
      body: { action: 'current-role' }
    }).then(({ data }) => {
      if (cancelled) return;
      if (!data?.success || !data.data) { setRole('none'); return; }
      const resolvedRole = data.data.role;
      setRole(resolvedRole === 'SUPER_ADMIN' ? 'super'
        : resolvedRole === 'ADMIN' ? 'admin'
        : resolvedRole === 'SECURITY_AGENT' ? 'security'
        : resolvedRole === 'RESIDENT' ? 'resident'
        : 'none');
    }).catch(() => { if (!cancelled) setRole('none'); });

    return () => { cancelled = true; };
  }, [user, loading]);

  return role;
}

export function useRoleLabel(role: UserRole): string {
  if (role === 'super') return ROLE_LABELS.SUPER_ADMIN;
  if (role === 'admin') return ROLE_LABELS.ADMIN;
  if (role === 'security') return ROLE_LABELS.SECURITY_AGENT;
  if (role === 'resident') return ROLE_LABELS.RESIDENT;
  return 'Residente';
}
