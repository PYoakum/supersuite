import React from 'react';
import { Bell, Clock, X, SkipForward } from 'lucide-react';
import {
  usePendingReminders,
  useSnoozeReminder,
  useDismissReminder,
} from './useReminders';
import type { PendingReminder } from '@calendar/types';

const SNOOZE_OPTIONS = [
  { label: '5 min', minutes: 5 },
  { label: '15 min', minutes: 15 },
  { label: '1 hour', minutes: 60 },
];

export function ReminderToast() {
  const { pending, removeFromPending } = usePendingReminders();
  const snoozeMutation = useSnoozeReminder();
  const dismissMutation = useDismissReminder();

  if (pending.length === 0) return null;

  async function handleSnooze(reminder: PendingReminder, minutes: number) {
    await snoozeMutation.mutateAsync({ id: reminder.id, minutes });
    removeFromPending(reminder.id);
  }

  async function handleDismiss(reminder: PendingReminder) {
    await dismissMutation.mutateAsync(reminder.id);
    removeFromPending(reminder.id);
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      zIndex: 300,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      maxWidth: 360,
    }}>
      {pending.map((reminder) => (
        <ReminderCard
          key={reminder.id}
          reminder={reminder}
          onSnooze={(m) => handleSnooze(reminder, m)}
          onDismiss={() => handleDismiss(reminder)}
        />
      ))}
    </div>
  );
}

function ReminderCard({
  reminder,
  onSnooze,
  onDismiss,
}: {
  reminder: PendingReminder;
  onSnooze: (minutes: number) => void;
  onDismiss: () => void;
}) {
  const event = reminder.event;
  const timeStr = event.allDay
    ? 'All day'
    : new Date(event.startAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

  return (
    <div
      style={{
        padding: '14px 16px',
        backgroundColor: '#fff',
        borderRadius: 10,
        boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
        border: '1px solid var(--color-border)',
        animation: 'slideIn 0.3s ease-out',
      }}
      role="alert"
      aria-live="assertive"
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <Bell size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title}
          </span>
        </div>
        <button
          onClick={onDismiss}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24, height: 24, border: 'none', borderRadius: 4,
            background: 'transparent', cursor: 'pointer',
            color: 'var(--color-text-secondary)',
          }}
          aria-label="Dismiss reminder"
        >
          <X size={14} />
        </button>
      </div>

      {/* Time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
        <Clock size={13} />
        {timeStr}
        {event.location && ` · ${event.location}`}
      </div>

      {/* Snooze options */}
      <div style={{ display: 'flex', gap: 6 }}>
        {SNOOZE_OPTIONS.map((opt) => (
          <button
            key={opt.minutes}
            onClick={() => onSnooze(opt.minutes)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '4px 10px',
              fontSize: 12, fontWeight: 500,
              border: '1px solid var(--color-border)',
              borderRadius: 5,
              background: 'var(--color-bg)',
              cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
          >
            <SkipForward size={11} />
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
