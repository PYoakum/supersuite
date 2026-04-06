import React from 'react';
import type { CalendarEvent } from '@calendar/types';

interface DayCellProps {
  date: Date;
  events: CalendarEvent[];
  isCurrentMonth: boolean;
  isToday: boolean;
  onClick: () => void;
}

const MAX_VISIBLE = 3;

export function DayCell({ date, events, isCurrentMonth, isToday, onClick }: DayCellProps) {
  const dayNum = date.getDate();
  const overflow = events.length - MAX_VISIBLE;

  return (
    <div
      onClick={onClick}
      role="gridcell"
      aria-label={`${date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}, ${events.length} events`}
      style={{
        padding: '4px 6px',
        borderRight: '1px solid var(--color-border)',
        borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer',
        opacity: isCurrentMonth ? 1 : 0.4,
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      {/* Day number */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: '50%',
        fontSize: 13,
        fontWeight: isToday ? 700 : 400,
        color: isToday ? '#fff' : 'var(--color-text)',
        backgroundColor: isToday ? 'var(--color-primary)' : 'transparent',
        marginBottom: 2,
      }}>
        {dayNum}
      </div>

      {/* Event pills */}
      {events.slice(0, MAX_VISIBLE).map((event) => (
        <div
          key={event.id}
          style={{
            fontSize: 11,
            lineHeight: '16px',
            padding: '0 4px',
            borderRadius: 3,
            marginBottom: 1,
            backgroundColor: '#DBEAFE',
            color: '#1E40AF',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {event.allDay ? event.title : `${fmtTime(event.startAt)} ${event.title}`}
        </div>
      ))}

      {overflow > 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '0 4px' }}>
          +{overflow} more
        </div>
      )}
    </div>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
