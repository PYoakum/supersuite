import { useState, useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export type ConnectionStatus = 'online' | 'offline' | 'reconnecting';

/**
 * Monitors network connectivity and triggers data reconciliation
 * when the app comes back online after an offline period.
 */
export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>(
    navigator.onLine ? 'online' : 'offline',
  );
  const wasOffline = useRef(false);
  const queryClient = useQueryClient();

  const handleOnline = useCallback(() => {
    if (wasOffline.current) {
      setStatus('reconnecting');
      // Invalidate all queries to reconcile with server
      queryClient.invalidateQueries().then(() => {
        setStatus('online');
        wasOffline.current = false;
      });
    } else {
      setStatus('online');
    }
  }, [queryClient]);

  const handleOffline = useCallback(() => {
    setStatus('offline');
    wasOffline.current = true;
  }, []);

  useEffect(() => {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleOnline, handleOffline]);

  return status;
}

/**
 * Displays a subtle connection status banner when offline or reconnecting.
 */
export function ConnectionBanner() {
  const status = useConnectionStatus();

  if (status === 'online') return null;

  const config = status === 'offline'
    ? { bg: '#FEF3C7', color: '#92400E', text: 'You are offline. Changes will sync when reconnected.' }
    : { bg: '#DBEAFE', color: '#1E40AF', text: 'Reconnecting and syncing data...' };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        padding: '6px 16px',
        backgroundColor: config.bg,
        color: config.color,
        fontSize: 13,
        fontWeight: 500,
        textAlign: 'center',
        zIndex: 400,
      }}
    >
      {config.text}
    </div>
  );
}
