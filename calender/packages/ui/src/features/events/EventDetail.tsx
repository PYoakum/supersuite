import React, { useState } from 'react';
import { Clock, MapPin, Repeat, Trash2, Edit3 } from 'lucide-react';
import { useDeleteEvent } from './useEvents';
import type { CalendarEvent } from '@calendar/types';

interface EventDetailProps {
  event: CalendarEvent;
  onEdit: (eventId: string) => void;
  onDeleted?: () => void;
}

export function EventDetail({ event, onEdit, onDeleted }: EventDetailProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useDeleteEvent();

  const startDate = new Date(event.startAt);
  const endDate = new Date(event.endAt);
  const timeStr = event.allDay
    ? 'All day'
    : `${fmt(startDate)} \u2013 ${fmt(endDate)}`;

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteMutation.mutateAsync({ id: event.id });
    onDeleted?.();
  }

  return (
    <div style={{
      padding: '12px 14px', marginBottom: 8,
      borderRadius: 8, border: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-bg)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{event.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <Clock size={13} />
            {timeStr}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <IconButton onClick={() => onEdit(event.id)} aria-label="Edit event">
            <Edit3 size={14} />
          </IconButton>
          <IconButton
            onClick={handleDelete}
            aria-label={confirmDelete ? 'Confirm delete' : 'Delete event'}
            danger={confirmDelete}
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      {event.location && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          <MapPin size={13} />
          {event.location}
        </div>
      )}

      {event.recurrenceRule && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
          <Repeat size={13} />
          {describeRecurrence(event.recurrenceRule)}
        </div>
      )}

      {event.description && (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.5 }}>
          {event.description}
        </p>
      )}

      {event.sourceType && (
        <span style={{
          display: 'inline-block', marginTop: 8, padding: '2px 6px',
          fontSize: 11, backgroundColor: '#F3F4F6', borderRadius: 4,
          color: 'var(--color-text-secondary)',
        }}>
          Imported {event.sourceRef ? `from ${event.sourceRef}` : ''}
        </span>
      )}

      {confirmDelete && (
        <div style={{
          marginTop: 8, padding: '6px 10px', fontSize: 12,
          backgroundColor: '#FEF2F2', borderRadius: 6, color: 'var(--color-danger)',
        }}>
          Click delete again to confirm. {event.recurrenceRule ? 'This deletes all instances.' : ''}
        </div>
      )}
    </div>
  );
}

function IconButton({
  children, danger, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      {...props}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, border: 'none', borderRadius: 6,
        background: danger ? '#FEF2F2' : 'var(--color-bg-secondary)',
        color: danger ? 'var(--color-danger)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function fmt(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function describeRecurrence(rule: string): string {
  const r = rule.replace(/^RRULE:/, '');
  if (r.includes('FREQ=DAILY')) return 'Repeats daily';
  if (r.includes('FREQ=WEEKLY') && r.includes('INTERVAL=2')) return 'Every 2 weeks';
  if (r.includes('FREQ=WEEKLY')) return 'Repeats weekly';
  if (r.includes('FREQ=MONTHLY')) return 'Repeats monthly';
  if (r.includes('FREQ=YEARLY')) return 'Repeats yearly';
  return 'Repeats';
}
