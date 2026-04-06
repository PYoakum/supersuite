import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import type { ImportSource } from '@calendar/types';

export function useImportSources() {
  return useQuery({
    queryKey: ['import-sources'],
    queryFn: () => api.get<ImportSource[]>('/imports/sources'),
  });
}

export function usePreviewIcs() {
  return useMutation({
    mutationFn: (icsData: string) =>
      api.post<{
        events: any[];
        warnings: string[];
        sourceInfo: { calendarName?: string; eventCount: number };
      }>('/imports/preview', { icsData }),
  });
}

export function useImportIcs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { icsData: string; calendarId?: string; filename?: string }) =>
      api.post<{ imported: number; updated: number; skipped: number }>(
        '/imports/upload',
        input,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['import-sources'] });
    },
  });
}

export function useSubscribeFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name?: string; calendarId?: string }) =>
      api.post('/imports/feeds', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sources'] });
      queryClient.invalidateQueries({ queryKey: ['calendars'] });
    },
  });
}

export function useSyncFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      api.post(`/imports/feeds/${sourceId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events'] });
      queryClient.invalidateQueries({ queryKey: ['import-sources'] });
    },
  });
}

export function useDeleteFeed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      api.delete(`/imports/feeds/${sourceId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['import-sources'] });
    },
  });
}
