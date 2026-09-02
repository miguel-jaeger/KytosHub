import { createContext, useContext, useState, type ReactNode } from 'react';

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

const STORAGE_KEY = 'kytoshub_active_condominium';

const loadStored = (): ActiveCondominium | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ActiveCondominium) : null;
  } catch {
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