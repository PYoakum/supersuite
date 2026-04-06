import { create } from 'zustand';

export type CalendarView = 'month' | 'week' | 'day';

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  setTokens: (access: string, refresh: string) => void;
  clearTokens: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: localStorage.getItem('accessToken'),
  refreshToken: localStorage.getItem('refreshToken'),
  setTokens: (access, refresh) => {
    localStorage.setItem('accessToken', access);
    localStorage.setItem('refreshToken', refresh);
    set({ accessToken: access, refreshToken: refresh });
  },
  clearTokens: () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    set({ accessToken: null, refreshToken: null });
  },
}));

interface CalendarNavState {
  currentDate: Date;
  view: CalendarView;
  setView: (view: CalendarView) => void;
  setCurrentDate: (date: Date) => void;
  navigateMonth: (delta: number) => void;
  goToToday: () => void;
}

export const useCalendarNavStore = create<CalendarNavState>((set) => ({
  currentDate: new Date(),
  view: 'month',
  setView: (view) => set({ view }),
  setCurrentDate: (date) => set({ currentDate: date }),
  navigateMonth: (delta) =>
    set((state) => {
      const next = new Date(state.currentDate);
      next.setMonth(next.getMonth() + delta);
      return { currentDate: next };
    }),
  goToToday: () => set({ currentDate: new Date() }),
}));
