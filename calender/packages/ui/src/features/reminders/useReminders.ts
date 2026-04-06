import { useState, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import type { PendingReminder } from '@calendar/types';

export function usePendingReminders() {
  const [pending, setPending] = useState<PendingReminder[]>([]);

  const addReminders = useCallback((reminders: PendingReminder[]) => {
    setPending((prev) => {
      const existingIds = new Set(prev.map((r) => r.id));
      const newOnes = reminders.filter((r) => !existingIds.has(r.id));
      return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
    });
  }, []);

  const removeFromPending = useCallback((id: string) => {
    setPending((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { pending, addReminders, removeFromPending };
}

export function useNotificationPolling() {
  const { addReminders } = usePendingReminders();

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const reminders = await api.get<PendingReminder[]>('/reminders/pending');
        if (active && reminders.length > 0) {
          addReminders(reminders);
        }
      } catch {
        // Silently ignore polling errors
      }
    }

    poll();
    const interval = setInterval(poll, 15_000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [addReminders]);
}

export function useSnoozeReminder() {
  return useMutation({
    mutationFn: ({ id, minutes }: { id: string; minutes: number }) =>
      api.post(`/reminders/${id}/snooze`, { minutes }),
  });
}

export function useDismissReminder() {
  return useMutation({
    mutationFn: (id: string) => api.post(`/reminders/${id}/dismiss`),
  });
}
