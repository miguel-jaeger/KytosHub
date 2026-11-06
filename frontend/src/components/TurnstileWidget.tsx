import { useEffect, useRef } from 'react';
import { TURNSTILE_SITE_KEY, loadTurnstile } from '../lib/turnstile';

interface TurnstileWidgetProps {
  /** Recibe el token cuando el reto se resuelve, o null si expira/falla. */
  onToken: (token: string | null) => void;
  theme?: 'auto' | 'light' | 'dark';
  action?: string;
  className?: string;
}

/**
 * Widget de Cloudflare Turnstile con render explícito (SPA).
 * Para pedir un token nuevo, remóntalo cambiando su prop `key`.
 */
export function TurnstileWidget({
  onToken,
  theme = 'auto',
  action = 'auth',
  className
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return;

    let cancelled = false;
    let widgetId: string | null = null;

    void loadTurnstile()
      .then(turnstile => {
        if (cancelled || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme,
          action,
          callback: token => onTokenRef.current(token),
          'error-callback': () => onTokenRef.current(null),
          'expired-callback': () => onTokenRef.current(null),
          'timeout-callback': () => onTokenRef.current(null)
        });
      })
      .catch(error => {
        console.error('Turnstile:', error);
        onTokenRef.current(null);
      });

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.remove(widgetId);
        } catch {
          /* el widget ya pudo haber sido removido */
        }
      }
    };
  }, [theme, action]);

  if (!TURNSTILE_SITE_KEY) return null;

  return <div ref={containerRef} className={className} />;
}
