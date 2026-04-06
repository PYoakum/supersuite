import React from 'react';
import { useCalendarNavStore } from '../../state/calendar-store';
import { useEventsRange } from '../../features/events/useEvents';
import type { CalendarEvent } from '@calendar/types';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 56;

export function DayView() {
  const { currentDate } = useCalendarNavStore();

  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(currentDate);
  dayEnd.setHours(23, 59, 59, 999);

  const { data: events = [] } = useEventsRange(dayStart, dayEnd);
  const allDayEvents = events.filter((e) => e.allDay);
  const timedEvents = events.filter((e) => !e.allDay);
  const isToday = isSameDay(currentDate, new Date());

  const dateLabel = currentDate.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Date header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: '1px solid var(--color-border)',
        fontSize: 15,
        fontWeight: 600,
      }}>
        {dateLabel}
      </div>

      {/* All-day section */}
      {allDayEvents.length > 0 && (
        <div style={{
          padding: '8px 20px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 4 }}>
            All Day
          </div>
          {allDayEvents.map((ev) => (
            <div key={ev.id} style={{
              padding: '4px 8px', marginBottom: 2,
              backgroundColor: '#DBEAFE', borderRadius: 4,
              fontSize: 13, fontWeight: 500,
            }}>
              {ev.title}
            </div>
          ))}
        </div>
      )}

      {/* Hourly timeline */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', position: 'relative' }}>
          {/* Time gutter */}
          <div style={{ width: 64, flexShrink: 0 }}>
            {HOURS.map((hour) => (
              <div key={hour} style={{
                height: HOUR_HEIGHT,
                fontSize: 12,
                color: 'var(--color-text-secondary)',
                textAlign: 'right',
                paddingRight: 12,
                paddingTop: 2,
                borderTop: '1px solid var(--color-border)',
              }}>
                {hour === 0 ? '' : formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Main column */}
          <div style={{
            flex: 1, position: 'relative',
            borderLeft: '1px solid var(--color-border)',
          }}>
            {/* Hour lines */}
            {HOURS.map((hour) => (
              <div key={hour} style={{ height: HOUR_HEIGHT, borderTop: '1px solid var(--color-border)' }} />
            ))}

            {/* Event blocks */}
            {timedEvents.map((event) => (
              <DayEventBlock key={event.id} event={event} />
            ))}

            {/* Current time line */}
            {isToday && <NowLine />}
          </div>
        </div>
      </div>
    </div>
  );
}

function DayEventBlock({ event }: { event: CalendarEvent }) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);

  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = (durationMinutes / 60) * HOUR_HEIGHT;

  const timeStr = `${fmt(start)} \u2013 ${fmt(end)}`;

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 4,
        right: 12,
        height: Math.max(height, 24),
        backgroundColor: '#3B82F6',
        color: '#fff',
        borderRadius: 6,
        padding: '4px 8px',
        fontSize: 13,
        overflow: 'hidden',
        cursor: 'pointer',
        zIndex: 1,
      }}
    >
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.title}
      </div>
      {height > 30 && (
        <div style={{ fontSize: 11, opacity: 0.85, marginTop: 1 }}>{timeStr}</div>
      )}
      {height > 50 && event.location && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 1 }}>{event.location}</div>
      )}
    </div>
  );
}

function NowLine() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = (minutes / 60) * HOUR_HEIGHT;

  return (
    <div style={{
      position: 'absolute', top, left: 0, right: 0,
      height: 2, backgroundColor: '#EF4444', zIndex: 2,
      pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', left: -4, top: -3,
        width: 8, height: 8, borderRadius: '50%',
        backgroundColor: '#EF4444',
      }} />
    </div>
  );
}

function fmt(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatHour(h: number): string {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 || 12;
  return `${hr} ${ampm}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
