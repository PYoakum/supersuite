import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useCreateEvent, useUpdateEvent, useEvent } from './useEvents';
import { useCalendars } from '../../hooks/useCalendars';
import { REMINDER_PRESETS } from '@calendar/types';

interface EventFormProps {
  eventId?: string | null;
  defaultDate?: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved?: () => void;
}

const RECURRENCE_OPTIONS = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'FREQ=DAILY' },
  { label: 'Weekly', value: 'FREQ=WEEKLY' },
  { label: 'Every 2 weeks', value: 'FREQ=WEEKLY;INTERVAL=2' },
  { label: 'Monthly', value: 'FREQ=MONTHLY' },
  { label: 'Yearly', value: 'FREQ=YEARLY' },
];

export function EventForm({ eventId, defaultDate, onClose, onSaved }: EventFormProps) {
  const isEditing = !!eventId;
  const { data: existingEvent } = useEvent(eventId || null);
  const { data: calendars = [] } = useCalendars();
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();

  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0];
  const today = defaultDate || new Date().toISOString().split('T')[0];

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState('09:00');
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState('10:00');
  const [allDay, setAllDay] = useState(false);
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<number[]>([10]);
  const [error, setError] = useState('');

  // Populate form when editing
  useEffect(() => {
    if (existingEvent) {
      setTitle(existingEvent.title);
      setDescription(existingEvent.description || '');
      setLocation(existingEvent.location || '');
      setCalendarId(existingEvent.calendarId);
      setAllDay(existingEvent.allDay);
      setRecurrenceRule(existingEvent.recurrenceRule || '');

      const start = new Date(existingEvent.startAt);
      const end = new Date(existingEvent.endAt);
      setStartDate(formatDateInput(start));
      setStartTime(formatTimeInput(start));
      setEndDate(formatDateInput(end));
      setEndTime(formatTimeInput(end));
    }
  }, [existingEvent]);

  // Set default calendar once loaded
  useEffect(() => {
    if (!calendarId && defaultCalendar) {
      setCalendarId(defaultCalendar.id);
    }
  }, [defaultCalendar, calendarId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    const startAt = allDay
      ? `${startDate}T00:00:00.000Z`
      : `${startDate}T${startTime}:00.000Z`;
    const endAt = allDay
      ? `${endDate}T23:59:59.999Z`
      : `${endDate}T${endTime}:00.000Z`;

    if (new Date(endAt) <= new Date(startAt)) {
      setError('End time must be after start time');
      return;
    }

    try {
      if (isEditing && eventId) {
        await updateMutation.mutateAsync({
          id: eventId,
          data: {
            title: title.trim(),
            description: description.trim() || null,
            location: location.trim() || null,
            startAt,
            endAt,
            allDay,
            recurrenceRule: recurrenceRule || null,
            calendarId,
          },
        });
      } else {
        await createMutation.mutateAsync({
          calendarId,
          title: title.trim(),
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          startAt,
          endAt,
          allDay,
          recurrenceRule: recurrenceRule || undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          reminders: reminderMinutes.map((m) => ({ offsetMinutes: m })),
        });
      }
      onSaved?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save event');
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>
            {isEditing ? 'Edit Event' : 'New Event'}
          </h2>
          <button onClick={onClose} style={closeButtonStyle} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '16px 20px', overflow: 'auto', flex: 1 }}>
          {error && <div style={errorStyle}>{error}</div>}

          {/* Title */}
          <div style={fieldStyle}>
            <input
              type="text"
              placeholder="Add title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              style={{ ...inputStyle, fontSize: 17, fontWeight: 600, border: 'none', padding: '4px 0' }}
            />
          </div>

          {/* All day toggle */}
          <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              id="allDay"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <label htmlFor="allDay" style={{ fontSize: 14 }}>All day</label>
          </div>

          {/* Date/Time row */}
          <div style={{ ...fieldStyle, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 130 }}>
              <label style={labelStyle}>Start</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            {!allDay && (
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Time</label>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
              </div>
            )}
            <div style={{ flex: 1, minWidth: 130 }}>
              <label style={labelStyle}>End</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            </div>
            {!allDay && (
              <div style={{ width: 110 }}>
                <label style={labelStyle}>Time</label>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
              </div>
            )}
          </div>

          {/* Recurrence */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Repeat</label>
            <select
              value={recurrenceRule}
              onChange={(e) => setRecurrenceRule(e.target.value)}
              style={inputStyle}
            >
              {RECURRENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Calendar picker */}
          {calendars.length > 1 && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Calendar</label>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                style={inputStyle}
              >
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Location */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Location</label>
            <input
              type="text"
              placeholder="Add location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              style={inputStyle}
            />
          </div>

          {/* Description */}
          <div style={fieldStyle}>
            <label style={labelStyle}>Description</label>
            <textarea
              placeholder="Add description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* Reminders (only on create) */}
          {!isEditing && (
            <div style={fieldStyle}>
              <label style={labelStyle}>Reminder</label>
              <select
                value={reminderMinutes[0] ?? ''}
                onChange={(e) => {
                  const val = e.target.value;
                  setReminderMinutes(val === '' ? [] : [parseInt(val, 10)]);
                }}
                style={inputStyle}
              >
                <option value="">No reminder</option>
                {REMINDER_PRESETS.map((p) => (
                  <option key={p.minutes} value={p.minutes}>{p.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" onClick={onClose} style={secondaryButtonStyle}>
              Cancel
            </button>
            <button type="submit" disabled={isPending} style={{
              ...primaryButtonStyle,
              opacity: isPending ? 0.7 : 1,
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}>
              {isPending ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────

function formatDateInput(d: Date): string {
  return d.toISOString().split('T')[0];
}

function formatTimeInput(d: Date): string {
  return d.toTimeString().slice(0, 5);
}

// ── Styles ─────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200,
};

const modalStyle: React.CSSProperties = {
  width: 520, maxHeight: '85vh',
  backgroundColor: 'var(--color-bg)', borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
};

const closeButtonStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, border: 'none', borderRadius: 6,
  background: 'var(--color-bg-secondary)', cursor: 'pointer',
};

const fieldStyle: React.CSSProperties = { marginBottom: 14 };

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: 'var(--color-text-secondary)', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 14, outline: 'none', backgroundColor: 'var(--color-bg)',
};

const errorStyle: React.CSSProperties = {
  padding: '8px 12px', marginBottom: 14,
  backgroundColor: '#FEF2F2', color: 'var(--color-danger)',
  borderRadius: 6, fontSize: 13,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px', backgroundColor: 'var(--color-primary)',
  color: '#fff', border: 'none', borderRadius: 6,
  fontSize: 14, fontWeight: 600, cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 20px', backgroundColor: 'transparent',
  color: 'var(--color-text)', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 14, cursor: 'pointer',
};
