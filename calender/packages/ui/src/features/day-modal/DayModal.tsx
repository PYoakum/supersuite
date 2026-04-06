import React, { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useDayEvents } from '../events/useEvents';
import { EventDetail } from '../events/EventDetail';
import { useUIStore } from '../../state/ui-store';
import { X, Plus } from 'lucide-react';

interface DayModalProps {
  date: string; // YYYY-MM-DD
  onClose: () => void;
}

export function DayModal({ date, onClose }: DayModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { openEventForm } = useUIStore();
  const queryClient = useQueryClient();

  const { data: events = [], isLoading } = useDayEvents(date);

  // Focus trap and Escape handling
  useEffect(() => {
    modalRef.current?.focus();
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const dateObj = new Date(date + 'T12:00:00');
  const formattedDate = dateObj.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);

  function handleEdit(eventId: string) {
    openEventForm(eventId);
  }

  function handleDeleted() {
    queryClient.invalidateQueries({ queryKey: ['day-events', date] });
    queryClient.invalidateQueries({ queryKey: ['events'] });
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Events for ${formattedDate}`}
    >
      <div
        ref={modalRef}
        tabIndex={-1}
        style={{
          width: 480, maxHeight: '80vh',
          backgroundColor: 'var(--color-bg)', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
        }}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{formattedDate}</h2>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, border: 'none', borderRadius: 6,
              background: 'var(--color-bg-secondary)', cursor: 'pointer',
            }}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
          {isLoading && (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>Loading events...</p>
          )}

          {!isLoading && events.length === 0 && (
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              No events scheduled for this day.
            </p>
          )}

          {/* All-day events */}
          {allDayEvents.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={sectionLabelStyle}>All Day</h3>
              {allDayEvents.map((event) => (
                <EventDetail key={event.id} event={event} onEdit={handleEdit} onDeleted={handleDeleted} />
              ))}
            </div>
          )}

          {/* Timed events */}
          {timedEvents.length > 0 && (
            <div>
              {allDayEvents.length > 0 && <h3 style={sectionLabelStyle}>Schedule</h3>}
              {timedEvents.map((event) => (
                <EventDetail key={event.id} event={event} onEdit={handleEdit} onDeleted={handleDeleted} />
              ))}
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={() => openEventForm()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px',
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Plus size={16} />
            New Event
          </button>
        </div>
      </div>
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase', marginBottom: 8,
};
