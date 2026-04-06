import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import type { Calendar } from '@calendar/types';

export function useCalendars() {
  return useQuery({
    queryKey: ['calendars'],
    queryFn: () => api.get<Calendar[]>('/calendars'),
  });
}

export function useCreateCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; color?: string }) =>
      api.post<Calendar>('/calendars', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
    },
  });
}
