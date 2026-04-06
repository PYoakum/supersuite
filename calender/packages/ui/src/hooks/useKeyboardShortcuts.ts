import { useEffect, useCallback } from 'react';
import { useCalendarNavStore, type CalendarView } from '../state/calendar-store';
import { useUIStore } from '../state/ui-store';

/**
 * Global keyboard shortcuts for the calendar application.
 *
 * Shortcuts:
 *   T         → Go to today
 *   M         → Month view
 *   W         → Week view
 *   D         → Day view
 *   N         → New event
 *   ←/→       → Navigate prev/next (period depends on current view)
 *   Escape    → Close any open modal
 *   /         → Focus search (future)
 *   ?         → Show keyboard shortcuts (future)
 */
export function useKeyboardShortcuts() {
  const { view, setView, navigateMonth, goToToday, currentDate } = useCalendarNavStore();
  const {
    openEventForm, closeEventForm, closeDayModal,
    closeIcsUpload, closeFeedSubscribe,
    isEventFormOpen, isDayModalOpen, isIcsUploadOpen, isFeedSubscribeOpen,
  } = useUIStore();

  const anyModalOpen = isEventFormOpen || isDayModalOpen || isIcsUploadOpen || isFeedSubscribeOpen;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when typing in an input/textarea/select
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // Escape always works — close the topmost modal
      if (e.key === 'Escape') {
        if (isEventFormOpen) { closeEventForm(); return; }
        if (isIcsUploadOpen) { closeIcsUpload(); return; }
        if (isFeedSubscribeOpen) { closeFeedSubscribe(); return; }
        if (isDayModalOpen) { closeDayModal(); return; }
        return;
      }

      // All other shortcuts are blocked when typing or a modal is open
      if (isInput || anyModalOpen) return;

      switch (e.key) {
        case 't':
        case 'T':
          goToToday();
          break;

        case 'm':
        case 'M':
          setView('month');
          break;

        case 'w':
        case 'W':
          setView('week');
          break;

        case 'd':
        case 'D':
          setView('day');
          break;

        case 'n':
        case 'N':
          openEventForm();
          break;

        case 'ArrowLeft':
          e.preventDefault();
          navigate(view, currentDate, -1);
          break;

        case 'ArrowRight':
          e.preventDefault();
          navigate(view, currentDate, 1);
          break;
      }
    },
    [view, currentDate, anyModalOpen, isEventFormOpen, isDayModalOpen, isIcsUploadOpen, isFeedSubscribeOpen],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

function navigate(view: CalendarView, currentDate: Date, delta: number) {
  const store = useCalendarNavStore.getState();
  if (view === 'month') {
    store.navigateMonth(delta);
  } else if (view === 'week') {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta * 7);
    store.setCurrentDate(next);
  } else {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta);
    store.setCurrentDate(next);
  }
}
