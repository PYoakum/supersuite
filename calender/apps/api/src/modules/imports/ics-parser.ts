import { logger } from '../../lib/logger';

/**
 * Lightweight ICS parser for importing .ics files and feed data.
 *
 * Parses VCALENDAR/VEVENT components from iCalendar (RFC 5545) format.
 * For production, consider using ical.js for full spec compliance.
 * This parser handles the most common fields needed for MVP import.
 */

export interface ParsedEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  dtstart: string;
  dtend?: string;
  allDay: boolean;
  rrule?: string;
  organizer?: string;
  attendees: string[];
}

export interface IcsParseResult {
  calendarName?: string;
  events: ParsedEvent[];
  warnings: string[];
}

export function parseIcs(icsData: string): IcsParseResult {
  const warnings: string[] = [];
  const events: ParsedEvent[] = [];
  let calendarName: string | undefined;

  // Normalize line endings and unfold continuation lines
  const normalized = icsData
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');  // Unfold long lines

  const lines = normalized.split('\n');

  let inEvent = false;
  let currentEvent: Partial<ParsedEvent> = {};
  let attendees: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Calendar-level properties
    if (!inEvent) {
      if (trimmed.startsWith('X-WR-CALNAME:')) {
        calendarName = extractValue(trimmed);
      }
    }

    // Event boundaries
    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      currentEvent = {};
      attendees = [];
      continue;
    }

    if (trimmed === 'END:VEVENT') {
      inEvent = false;

      // Validate minimum required fields
      if (!currentEvent.uid) {
        currentEvent.uid = generateFallbackUid();
        warnings.push('Event missing UID, generated fallback');
      }
      if (!currentEvent.summary) {
        currentEvent.summary = '(No title)';
        warnings.push(`Event ${currentEvent.uid} missing SUMMARY`);
      }
      if (!currentEvent.dtstart) {
        warnings.push(`Event ${currentEvent.uid} missing DTSTART, skipped`);
        continue;
      }

      events.push({
        uid: currentEvent.uid,
        summary: currentEvent.summary,
        description: currentEvent.description,
        location: currentEvent.location,
        dtstart: currentEvent.dtstart,
        dtend: currentEvent.dtend,
        allDay: currentEvent.allDay || false,
        rrule: currentEvent.rrule,
        organizer: currentEvent.organizer,
        attendees,
      });
      continue;
    }

    if (!inEvent) continue;

    // Parse event properties
    try {
      if (trimmed.startsWith('UID:')) {
        currentEvent.uid = extractValue(trimmed);
      } else if (trimmed.startsWith('SUMMARY')) {
        currentEvent.summary = extractValue(trimmed);
      } else if (trimmed.startsWith('DESCRIPTION')) {
        currentEvent.description = unescapeIcsText(extractValue(trimmed));
      } else if (trimmed.startsWith('LOCATION')) {
        currentEvent.location = unescapeIcsText(extractValue(trimmed));
      } else if (trimmed.startsWith('DTSTART')) {
        const { value, isDate } = parseDateProperty(trimmed);
        currentEvent.dtstart = value;
        currentEvent.allDay = isDate;
      } else if (trimmed.startsWith('DTEND')) {
        const { value } = parseDateProperty(trimmed);
        currentEvent.dtend = value;
      } else if (trimmed.startsWith('RRULE:')) {
        currentEvent.rrule = trimmed.slice(6);
      } else if (trimmed.startsWith('ORGANIZER')) {
        currentEvent.organizer = extractOrganizerEmail(trimmed);
      } else if (trimmed.startsWith('ATTENDEE')) {
        const email = extractAttendeeEmail(trimmed);
        if (email) attendees.push(email);
      }
    } catch (err) {
      warnings.push(`Error parsing line: ${trimmed.slice(0, 80)}`);
    }
  }

  return { calendarName, events, warnings };
}

// ── Internal helpers ───────────────────────────────────────

function extractValue(line: string): string {
  // Handle properties with parameters: PROP;PARAM=VAL:actualvalue
  const colonIdx = line.indexOf(':');
  return colonIdx >= 0 ? line.slice(colonIdx + 1) : line;
}

function parseDateProperty(line: string): { value: string; isDate: boolean } {
  const colonIdx = line.indexOf(':');
  const params = line.slice(0, colonIdx);
  const raw = line.slice(colonIdx + 1).trim();

  const isDate = params.includes('VALUE=DATE') || /^\d{8}$/.test(raw);

  if (isDate) {
    // DATE format: YYYYMMDD
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    return { value: `${y}-${m}-${d}T00:00:00.000Z`, isDate: true };
  }

  // DATETIME format: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMSS
  const y = raw.slice(0, 4);
  const m = raw.slice(4, 6);
  const d = raw.slice(6, 8);
  const h = raw.slice(9, 11) || '00';
  const mi = raw.slice(11, 13) || '00';
  const s = raw.slice(13, 15) || '00';
  const isUtc = raw.endsWith('Z');

  return {
    value: `${y}-${m}-${d}T${h}:${mi}:${s}.000${isUtc ? 'Z' : ''}`,
    isDate: false,
  };
}

function extractOrganizerEmail(line: string): string {
  // ORGANIZER;CN=Name:mailto:email@example.com
  const match = line.match(/mailto:([^\s;]+)/i);
  return match ? match[1] : extractValue(line);
}

function extractAttendeeEmail(line: string): string | null {
  const match = line.match(/mailto:([^\s;]+)/i);
  return match ? match[1] : null;
}

function unescapeIcsText(text: string): string {
  return text
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function generateFallbackUid(): string {
  return `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
