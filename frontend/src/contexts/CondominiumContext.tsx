import { createContext, useContext, useState, type ReactNode } from 'react';
import { ACTIVE_CONDOMINIUM_KEY } from '../lib/auth-storage';

export interface ActiveCondominium {
  tenant_id: string;
  name: string;
  slug: string;
  short_name: string;
  schema_name: string;
  image_url: string | null;
}

interface CondominiumContextValue {
  condominium: ActiveCondominium | null;
  setCondominium: (condo: ActiveCondominium | null) => void;
  clearCondominium: () => void;
}

const STORAGE_KEY = ACTIVE_CONDOMINIUM_KEY;

const loadStored = (): ActiveCondominium | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveCondominium;
    if (!parsed?.tenant_id || !parsed?.schema_name) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt/partial JSON: drop it so it never breaks the app on load.
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    return null;
  }
};

const CondominiumContext = createContext<CondominiumContextValue | undefined>(undefined);

export function CondominiumProvider({ children }: { children: ReactNode }) {
  const [condominium, setCondominiumState] = useState<ActiveCondominium | null>(loadStored);

  const setCondominium = (condo: ActiveCondominium | null) => {
    setCondominiumState(condo);
    if (condo) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(condo));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const clearCondominium = () => {
    setCondominium(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  return (
    <CondominiumContext.Provider value={{ condominium, setCondominium, clearCondominium }}>
      {children}
    </CondominiumContext.Provider>
  );
}

export function useCondominium() {
  const context = useContext(CondominiumContext);
  if (context === undefined) {
    throw new Error('useCondominium must be used within a CondominiumProvider');
  }
  return context;
}