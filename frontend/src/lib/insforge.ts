import { createClient } from '@insforge/sdk';

const INSFORGE_URL = import.meta.env.VITE_INSFORGE_URL || '';
const ANON_KEY = import.meta.env.VITE_INSFORGE_ANON_KEY || '';

export const insforge = createClient({
  baseUrl: INSFORGE_URL,
  anonKey: ANON_KEY
});

export const getAuthClient = (accessToken: string) => {
  return createClient({
    baseUrl: INSFORGE_URL,
    accessToken
  });
};
