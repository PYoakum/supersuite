import React from 'react';
import { useAuthStore } from './state/calendar-store';
import { LoginForm } from './features/auth/LoginForm';
import { CalendarShell } from './components/layout/CalendarShell';
import { ReminderToast } from './features/reminders/ReminderToast';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { ConnectionBanner } from './hooks/useConnectionStatus';
import { useNotificationPolling } from './features/reminders/useReminders';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

function AuthenticatedApp() {
  useNotificationPolling();
  useKeyboardShortcuts();

  return (
    <>
      {/* Skip-to-content link for keyboard users */}
      <a href="#main-calendar" className="skip-link">
        Skip to calendar
      </a>
      <ConnectionBanner />
      <CalendarShell />
      <ReminderToast />
    </>
  );
}

export default function App() {
  const { accessToken } = useAuthStore();

  return (
    <ErrorBoundary>
      {accessToken ? <AuthenticatedApp /> : <LoginForm />}
    </ErrorBoundary>
  );
}
