import React from 'react';
import { useCalendarNavStore } from '../../state/calendar-store';
import { useUIStore } from '../../state/ui-store';
import { useEventsRange, groupEventsByDate } from '../../features/events/useEvents';
import { getWeekRange } from '@calendar/shared-utils';
import type { CalendarEvent } from '@calendar/types';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 48;
const DAY_HEADERS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeekView() {
  const { currentDate } = useCalendarNavStore();
  const { openDayModal } = useUIStore();
  const { start, end } = getWeekRange(currentDate);

  const weekDates: Date[] = [];
  const d = new Date(start);
  for (let i = 0; i < 7; i++) {
    weekDates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  const { data: events = [] } = useEventsRange(start, end);
  const eventsByDate = groupEventsByDate(events);
  const allDayEvents = events.filter((e) => e.allDay);
  const today = new Date();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Day headers */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)' }}>
        <div style={{ width: 56, flexShrink: 0 }} />
        {weekDates.map((date, i) => {
          const isToday = isSameDay(date, today);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                padding: '8px 4px',
                textAlign: 'center',
                borderLeft: '1px solid var(--color-border)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
                {DAY_HEADERS_SHORT[date.getDay()]}
              </div>
              <div
                onClick={() => openDayModal(fmtDate(date))}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: '50%',
                  fontSize: 15, fontWeight: isToday ? 700 : 400,
                  color: isToday ? '#fff' : 'var(--color-text)',
                  backgroundColor: isToday ? 'var(--color-primary)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                {date.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* All-day row */}
      {allDayEvents.length > 0 && (
        <div style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          minHeight: 28,
        }}>
          <div style={{ width: 56, flexShrink: 0, fontSize: 10, color: 'var(--color-text-secondary)', padding: '4px 8px' }}>
            ALL DAY
          </div>
          {weekDates.map((date, i) => {
            const dateKey = fmtDate(date);
            const dayAllDay = allDayEvents.filter(
              (e) => new Date(e.startAt).toISOString().split('T')[0] === dateKey,
            );
            return (
              <div key={i} style={{ flex: 1, padding: '2px 2px', borderLeft: '1px solid var(--color-border)' }}>
                {dayAllDay.map((ev) => (
                  <div key={ev.id} style={{
                    fontSize: 11, padding: '1px 4px', borderRadius: 3,
                    backgroundColor: '#DBEAFE', marginBottom: 1,
                    overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                  }}>
                    {ev.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Hourly grid */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ display: 'flex', position: 'relative' }}>
          {/* Time gutter */}
          <div style={{ width: 56, flexShrink: 0 }}>
            {HOURS.map((hour) => (
              <div key={hour} style={{
                height: HOUR_HEIGHT,
                fontSize: 11,
                color: 'var(--color-text-secondary)',
                textAlign: 'right',
                paddingRight: 8,
                paddingTop: 2,
                borderTop: '1px solid var(--color-border)',
              }}>
                {hour === 0 ? '' : formatHour(hour)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {weekDates.map((date, i) => {
            const dateKey = fmtDate(date);
            const dayEvents = (eventsByDate.get(dateKey) || []).filter((e) => !e.allDay);
            const isToday = isSameDay(date, today);

            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  position: 'relative',
                  borderLeft: '1px solid var(--color-border)',
                  backgroundColor: isToday ? 'rgba(59,130,246,0.03)' : 'transparent',
                }}
                onClick={() => openDayModal(dateKey)}
              >
                {/* Hour lines */}
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    style={{
                      height: HOUR_HEIGHT,
                      borderTop: '1px solid var(--color-border)',
                    }}
                  />
                ))}

                {/* Event blocks */}
                {dayEvents.map((event) => (
                  <EventBlock key={event.id} event={event} />
                ))}

                {/* Current time indicator */}
                {isToday && <NowIndicator />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EventBlock({ event }: { event: CalendarEvent }) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const startMinutes = start.getHours() * 60 + start.getMinutes();
  const endMinutes = end.getHours() * 60 + end.getMinutes();
  const durationMinutes = Math.max(endMinutes - startMinutes, 15);

  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = (durationMinutes / 60) * HOUR_HEIGHT;

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 2,
        right: 2,
        height: Math.max(height, 18),
        backgroundColor: '#3B82F6',
        color: '#fff',
        borderRadius: 4,
        padding: '2px 4px',
        fontSize: 11,
        lineHeight: '14px',
        overflow: 'hidden',
        cursor: 'pointer',
        zIndex: 1,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {event.title}
      </div>
      {height > 24 && (
        <div style={{ fontSize: 10, opacity: 0.85 }}>
          {fmt(start)} - {fmt(end)}
        </div>
      )}
    </div>
  );
}

function NowIndicator() {
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

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
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
