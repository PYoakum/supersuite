import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import type { CalendarEvent } from '@calendar/types';

export function useEventsRange(start: Date, end: Date) {
  return useQuery({
    queryKey: ['events', start.toISOString(), end.toISOString()],
    queryFn: () =>
      api.get<CalendarEvent[]>(
        `/events?start=${start.toISOString()}&end=${end.toISOString()}`,
      ),
  });
}

export function useDayEvents(date: string) {
  const start = `${date}T00:00:00.000Z`;
  const end = `${date}T23:59:59.999Z`;
  return useQuery({
    queryKey: ['day-events', date],
    queryFn: () => api.get<CalendarEvent[]>(`/events?start=${start}&end=${end}`),
  });
}

export function useEvent(id: string | null) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: () => api.get<CalendarEvent>(`/events/${id}`),
    enabled: !!id,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post<CalendarEvent>('/events', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['day-events'] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch<CalendarEvent>(`/events/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['day-events'] });
      queryClient.invalidateQueries({ queryKey: ['event'] });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete(`/events/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['day-events'] });
    },
  });
}

export function groupEventsByDate(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const dateKey = new Date(event.startAt).toISOString().split('T')[0];
    const existing = map.get(dateKey) || [];
    existing.push(event);
    map.set(dateKey, existing);
  }
  return map;
}
