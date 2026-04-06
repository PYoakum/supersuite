import React, { useState } from 'react';
import { useCalendars, useCreateCalendar } from '../../hooks/useCalendars';
import { useCalendarNavStore } from '../../state/calendar-store';
import { useUIStore } from '../../state/ui-store';
import { getMonthGridDates } from '@calendar/shared-utils';
import { Plus, ChevronLeft, ChevronRight, Upload, Rss } from 'lucide-react';

export function Sidebar() {
  const { data: calendars = [] } = useCalendars();
  const { currentDate, setCurrentDate } = useCalendarNavStore();
  const { openIcsUpload, openFeedSubscribe } = useUIStore();
  const createCalendar = useCreateCalendar();
  const [newCalName, setNewCalName] = useState('');
  const [showNewCal, setShowNewCal] = useState(false);

  async function handleCreateCalendar() {
    if (!newCalName.trim()) return;
    await createCalendar.mutateAsync({ name: newCalName.trim() });
    setNewCalName('');
    setShowNewCal(false);
  }

  return (
    <aside style={{
      width: 220, flexShrink: 0,
      borderRight: '1px solid var(--color-border)',
      backgroundColor: 'var(--color-bg-secondary)',
      display: 'flex', flexDirection: 'column',
      overflow: 'auto',
    }}>
      {/* Mini calendar */}
      <MiniCalendar currentDate={currentDate} onDateSelect={setCurrentDate} />

      {/* Calendar list */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>
            Calendars
          </span>
          <button
            onClick={() => setShowNewCal(true)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, border: 'none', borderRadius: 4,
              background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-secondary)',
            }}
            aria-label="Add calendar"
          >
            <Plus size={14} />
          </button>
        </div>

        {calendars.map((cal) => (
          <div key={cal.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 4px', borderRadius: 4,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: 3,
              backgroundColor: cal.color,
              flexShrink: 0,
            }} />
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cal.name}
            </span>
          </div>
        ))}

        {showNewCal && (
          <div style={{ marginTop: 8, display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={newCalName}
              onChange={(e) => setNewCalName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateCalendar()}
              placeholder="Calendar name"
              autoFocus
              style={{
                flex: 1, padding: '4px 6px', fontSize: 12,
                border: '1px solid var(--color-border)', borderRadius: 4,
                outline: 'none',
              }}
            />
            <button
              onClick={handleCreateCalendar}
              style={{
                padding: '4px 8px', fontSize: 11, fontWeight: 600,
                backgroundColor: 'var(--color-primary)', color: '#fff',
                border: 'none', borderRadius: 4, cursor: 'pointer',
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {/* Import actions */}
      <div style={{
        padding: '12px 14px',
        borderTop: '1px solid var(--color-border)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
          Import
        </span>
        <button onClick={openIcsUpload} style={sidebarBtnStyle}>
          <Upload size={14} />
          Import .ics File
        </button>
        <button onClick={openFeedSubscribe} style={{ ...sidebarBtnStyle, marginTop: 4 }}>
          <Rss size={14} />
          Feed Subscriptions
        </button>
      </div>
    </aside>
  );
}

// ── Mini Calendar ──────────────────────────────────────────

function MiniCalendar({
  currentDate,
  onDateSelect,
}: {
  currentDate: Date;
  onDateSelect: (d: Date) => void;
}) {
  const [viewMonth, setViewMonth] = useState(new Date(currentDate));

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const gridDates = getMonthGridDates(year, month);
  const today = new Date();

  const monthLabel = viewMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  function nav(delta: number) {
    const next = new Date(viewMonth);
    next.setMonth(next.getMonth() + delta);
    setViewMonth(next);
  }

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{monthLabel}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <MiniBtn onClick={() => nav(-1)}><ChevronLeft size={14} /></MiniBtn>
          <MiniBtn onClick={() => nav(1)}><ChevronRight size={14} /></MiniBtn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, textAlign: 'center' }}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
          <div key={i} style={{ fontSize: 10, fontWeight: 500, color: 'var(--color-text-secondary)', padding: '2px 0' }}>
            {d}
          </div>
        ))}
        {gridDates.slice(0, 42).map((date, i) => {
          const isMonth = date.getMonth() === month;
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, currentDate);

          return (
            <button
              key={i}
              onClick={() => onDateSelect(new Date(date))}
              style={{
                width: 24, height: 24, margin: '1px auto',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: 'none', borderRadius: '50%',
                fontSize: 11,
                fontWeight: isToday ? 700 : 400,
                color: isSelected ? '#fff' : isMonth ? 'var(--color-text)' : '#ccc',
                backgroundColor: isSelected ? 'var(--color-primary)' : isToday ? '#E0E7FF' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MiniBtn({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 22, height: 22, border: 'none', borderRadius: 4,
        background: 'transparent', cursor: 'pointer',
        color: 'var(--color-text-secondary)',
      }}
    >
      {children}
    </button>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const sidebarBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  width: '100%', padding: '6px 8px',
  border: 'none', borderRadius: 4,
  background: 'transparent', cursor: 'pointer',
  fontSize: 13, color: 'var(--color-text-secondary)',
  textAlign: 'left',
};
