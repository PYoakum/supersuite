import React, { useMemo } from 'react';
import { useCalendarNavStore } from '../../state/calendar-store';
import { useUIStore } from '../../state/ui-store';
import { useEventsRange, groupEventsByDate } from '../../features/events/useEvents';
import { getMonthGridDates, getMonthRange } from '@calendar/shared-utils';
import { DayCell } from './DayCell';
import { LoadingState, ErrorState } from '../ui/LoadingStates';

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_HEADERS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function MonthView() {
  const { currentDate } = useCalendarNavStore();
  const { openDayModal } = useUIStore();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const gridDates = useMemo(() => getMonthGridDates(year, month), [year, month]);
  const gridStart = gridDates[0];
  const gridEnd = gridDates[gridDates.length - 1];

  const { data: events = [], isLoading, isError, refetch } = useEventsRange(gridStart, gridEnd);

  const eventsByDate = useMemo(() => groupEventsByDate(events), [events]);

  function handleDayClick(date: Date) {
    const dateStr = date.toISOString().split('T')[0];
    openDayModal(dateStr);
  }

  if (isError) {
    return <ErrorState message="Failed to load events" onRetry={() => refetch()} />;
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      role="grid"
      aria-label={`Calendar for ${currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
    >
      {/* Day headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: '1px solid var(--color-border)',
      }}
      role="row"
      >
        {DAY_HEADERS.map((day, i) => (
          <div
            key={day}
            role="columnheader"
            aria-label={DAY_HEADERS_FULL[i]}
            style={{
              padding: '8px 12px',
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--color-text-secondary)',
              textTransform: 'uppercase',
              textAlign: 'center',
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Loading overlay */}
      {isLoading && events.length === 0 && (
        <LoadingState message="Loading calendar..." />
      )}

      {/* Day grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gridTemplateRows: 'repeat(6, 1fr)',
        flex: 1,
        opacity: isLoading && events.length > 0 ? 0.6 : 1,
        transition: 'opacity 0.15s',
      }}>
        {gridDates.map((date, i) => {
          const dateKey = date.toISOString().split('T')[0];
          const dayEvents = eventsByDate.get(dateKey) || [];
          const isCurrentMonth = date.getMonth() === month;
          const isToday = isDateToday(date);

          return (
            <DayCell
              key={dateKey}
              date={date}
              events={dayEvents}
              isCurrentMonth={isCurrentMonth}
              isToday={isToday}
              onClick={() => handleDayClick(date)}
            />
          );
        })}
      </div>
    </div>
  );
}

function isDateToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}
