export { default as App } from './App';

// State
export { useAuthStore, useCalendarNavStore } from './state/calendar-store';
export { useUIStore } from './state/ui-store';

// Lib
export { api } from './lib/api-client';

// Hooks
export { useCalendars, useCreateCalendar } from './hooks/useCalendars';
export { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
export { useConnectionStatus, ConnectionBanner } from './hooks/useConnectionStatus';

// Layout
export { CalendarShell } from './components/layout/CalendarShell';
export { Sidebar } from './components/layout/Sidebar';

// Calendar views
export { MonthView } from './components/calendar/MonthView';
export { WeekView } from './components/calendar/WeekView';
export { DayView } from './components/calendar/DayView';

// UI
export { AccessibleModal } from './components/ui/AccessibleModal';
export { ErrorBoundary } from './components/ui/ErrorBoundary';

// Features
export { LoginForm } from './features/auth/LoginForm';
export { EventForm } from './features/events/EventForm';
export { EventDetail } from './features/events/EventDetail';
export { DayModal } from './features/day-modal/DayModal';
export { IcsUpload } from './features/imports/IcsUpload';
export { FeedSubscribe } from './features/imports/FeedSubscribe';
export { ReminderToast } from './features/reminders/ReminderToast';
