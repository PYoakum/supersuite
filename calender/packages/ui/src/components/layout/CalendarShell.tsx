import React from 'react';
import { useCalendarNavStore } from '../../state/calendar-store';
import { useUIStore } from '../../state/ui-store';
import { Sidebar } from './Sidebar';
import { MonthView } from '../calendar/MonthView';
import { WeekView } from '../calendar/WeekView';
import { DayView } from '../calendar/DayView';
import { DayModal } from '../../features/day-modal/DayModal';
import { EventForm } from '../../features/events/EventForm';
import { IcsUpload } from '../../features/imports/IcsUpload';
import { FeedSubscribe } from '../../features/imports/FeedSubscribe';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CalendarShell() {
  const { view, setView, currentDate, navigateMonth, goToToday, setCurrentDate } = useCalendarNavStore();
  const {
    isEventFormOpen, isDayModalOpen, isIcsUploadOpen, isFeedSubscribeOpen,
    dayModalDate, editingEventId,
    closeEventForm, closeDayModal, closeIcsUpload, closeFeedSubscribe,
  } = useUIStore();

  const monthLabel = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function handlePrev() {
    if (view === 'month') navigateMonth(-1);
    else if (view === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      setCurrentDate(d);
    }
  }

  function handleNext() {
    if (view === 'month') navigateMonth(1);
    else if (view === 'week') {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 7);
      setCurrentDate(d);
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + 1);
      setCurrentDate(d);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      <Sidebar />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }} id="main-calendar">
        {/* Toolbar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '10px 20px',
          borderBottom: '1px solid var(--color-border)',
        }}>
          <button onClick={goToToday} style={toolbarBtnStyle}>Today</button>

          <button onClick={handlePrev} style={navBtnStyle} aria-label="Previous">
            <ChevronLeft size={18} />
          </button>
          <button onClick={handleNext} style={navBtnStyle} aria-label="Next">
            <ChevronRight size={18} />
          </button>

          <span style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>{monthLabel}</span>

          <div style={{ display: 'flex', gap: 2 }}>
            {(['month', 'week', 'day'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  ...viewBtnStyle,
                  backgroundColor: view === v ? 'var(--color-primary)' : 'transparent',
                  color: view === v ? '#fff' : 'var(--color-text-secondary)',
                }}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* View */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {view === 'month' && <MonthView />}
          {view === 'week' && <WeekView />}
          {view === 'day' && <DayView />}
        </div>
      </div>

      {/* Modals */}
      {isDayModalOpen && dayModalDate && (
        <DayModal date={dayModalDate} onClose={closeDayModal} />
      )}
      {isEventFormOpen && (
        <EventForm
          eventId={editingEventId}
          defaultDate={dayModalDate || undefined}
          onClose={closeEventForm}
        />
      )}
      {isIcsUploadOpen && <IcsUpload onClose={closeIcsUpload} />}
      {isFeedSubscribeOpen && <FeedSubscribe onClose={closeFeedSubscribe} />}
    </div>
  );
}

const toolbarBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, fontWeight: 500,
  border: '1px solid var(--color-border)', borderRadius: 6,
  background: 'transparent', cursor: 'pointer',
};

const navBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 32, height: 32, border: 'none', borderRadius: 6,
  background: 'transparent', cursor: 'pointer',
};

const viewBtnStyle: React.CSSProperties = {
  padding: '5px 12px', fontSize: 13, fontWeight: 500,
  border: 'none', borderRadius: 6, cursor: 'pointer',
};
