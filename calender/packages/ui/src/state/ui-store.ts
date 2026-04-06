import { create } from 'zustand';

interface UIState {
  isEventFormOpen: boolean;
  isDayModalOpen: boolean;
  isIcsUploadOpen: boolean;
  isFeedSubscribeOpen: boolean;
  dayModalDate: string | null;
  editingEventId: string | null;

  openEventForm: (eventId?: string) => void;
  closeEventForm: () => void;
  openDayModal: (date: string) => void;
  closeDayModal: () => void;
  openIcsUpload: () => void;
  closeIcsUpload: () => void;
  openFeedSubscribe: () => void;
  closeFeedSubscribe: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  isEventFormOpen: false,
  isDayModalOpen: false,
  isIcsUploadOpen: false,
  isFeedSubscribeOpen: false,
  dayModalDate: null,
  editingEventId: null,

  openEventForm: (eventId) =>
    set({ isEventFormOpen: true, editingEventId: eventId || null }),
  closeEventForm: () =>
    set({ isEventFormOpen: false, editingEventId: null }),
  openDayModal: (date) =>
    set({ isDayModalOpen: true, dayModalDate: date }),
  closeDayModal: () =>
    set({ isDayModalOpen: false, dayModalDate: null }),
  openIcsUpload: () =>
    set({ isIcsUploadOpen: true }),
  closeIcsUpload: () =>
    set({ isIcsUploadOpen: false }),
  openFeedSubscribe: () =>
    set({ isFeedSubscribeOpen: true }),
  closeFeedSubscribe: () =>
    set({ isFeedSubscribeOpen: false }),
}));
