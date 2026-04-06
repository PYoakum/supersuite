import React, { useState, useRef } from 'react';
import { Upload, FileText, Check, AlertTriangle } from 'lucide-react';
import { useImportIcs, usePreviewIcs } from './useImports';
import { useCalendars } from '../../hooks/useCalendars';

interface IcsUploadProps {
  onClose: () => void;
  onImported?: () => void;
}

export function IcsUpload({ onClose, onImported }: IcsUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [icsData, setIcsData] = useState<string | null>(null);
  const [filename, setFilename] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [previewResult, setPreviewResult] = useState<{
    events: any[];
    warnings: string[];
    sourceInfo: { calendarName?: string; eventCount: number };
  } | null>(null);
  const [importResult, setImportResult] = useState<{
    imported: number;
    updated: number;
    skipped: number;
  } | null>(null);
  const [error, setError] = useState('');

  const { data: calendars = [] } = useCalendars();
  const previewMutation = usePreviewIcs();
  const importMutation = useImportIcs();

  const defaultCal = calendars.find((c) => c.isDefault) || calendars[0];

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setError('');
    setImportResult(null);
    setFilename(file.name);

    try {
      const text = await file.text();
      setIcsData(text);

      // Auto-preview
      const preview = await previewMutation.mutateAsync(text);
      setPreviewResult(preview);
    } catch (err: any) {
      setError(err.message || 'Failed to read file');
    }
  }

  async function handleImport() {
    if (!icsData) return;
    setError('');

    try {
      const result = await importMutation.mutateAsync({
        icsData,
        calendarId: calendarId || defaultCal?.id,
        filename,
      });
      setImportResult(result);
      onImported?.();
    } catch (err: any) {
      setError(err.message || 'Import failed');
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Import ICS File</h2>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflow: 'auto', flex: 1 }}>
          {error && <div style={errorStyle}>{error}</div>}

          {/* File selector */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".ics,.ical"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />

          {!icsData && (
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: '100%', padding: '32px 20px',
                border: '2px dashed var(--color-border)', borderRadius: 8,
                backgroundColor: 'var(--color-bg-secondary)',
                cursor: 'pointer', textAlign: 'center',
              }}
            >
              <Upload size={24} style={{ margin: '0 auto 8px', color: 'var(--color-primary)' }} />
              <div style={{ fontSize: 14, fontWeight: 500 }}>Choose .ics file</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                or drag and drop
              </div>
            </button>
          )}

          {/* Preview */}
          {previewResult && !importResult && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <FileText size={16} style={{ color: 'var(--color-primary)' }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>{filename}</span>
              </div>

              {previewResult.sourceInfo.calendarName && (
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                  Calendar: {previewResult.sourceInfo.calendarName}
                </div>
              )}

              <div style={{ fontSize: 14, marginBottom: 12 }}>
                {previewResult.sourceInfo.eventCount} event(s) found
              </div>

              {previewResult.warnings.length > 0 && (
                <div style={{ marginBottom: 12, padding: '8px 10px', backgroundColor: '#FFFBEB', borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#92400E', fontWeight: 500, marginBottom: 4 }}>
                    <AlertTriangle size={14} />
                    Warnings
                  </div>
                  {previewResult.warnings.slice(0, 5).map((w, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#78350F' }}>{w}</div>
                  ))}
                  {previewResult.warnings.length > 5 && (
                    <div style={{ fontSize: 12, color: '#78350F' }}>
                      ...and {previewResult.warnings.length - 5} more
                    </div>
                  )}
                </div>
              )}

              {/* Calendar picker */}
              {calendars.length > 1 && (
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Import into calendar</label>
                  <select
                    value={calendarId || defaultCal?.id || ''}
                    onChange={(e) => setCalendarId(e.target.value)}
                    style={inputStyle}
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Event preview list */}
              <div style={{ maxHeight: 200, overflow: 'auto', marginBottom: 14 }}>
                {previewResult.events.slice(0, 20).map((ev, i) => (
                  <div key={i} style={{
                    padding: '6px 8px', borderBottom: '1px solid var(--color-border)',
                    fontSize: 13,
                  }}>
                    <span style={{ fontWeight: 500 }}>{ev.summary}</span>
                    <span style={{ color: 'var(--color-text-secondary)', marginLeft: 8 }}>
                      {ev.allDay ? 'All day' : new Date(ev.dtstart).toLocaleDateString()}
                    </span>
                  </div>
                ))}
                {previewResult.events.length > 20 && (
                  <div style={{ padding: '6px 8px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    ...and {previewResult.events.length - 20} more events
                  </div>
                )}
              </div>

              <button
                onClick={handleImport}
                disabled={importMutation.isPending}
                style={{
                  ...primaryBtnStyle,
                  opacity: importMutation.isPending ? 0.7 : 1,
                }}
              >
                {importMutation.isPending ? 'Importing...' : `Import ${previewResult.sourceInfo.eventCount} Events`}
              </button>
            </div>
          )}

          {/* Import result */}
          {importResult && (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <Check size={32} style={{ color: 'var(--color-success)', margin: '0 auto 12px' }} />
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Import Complete</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {importResult.imported} imported, {importResult.updated} updated, {importResult.skipped} skipped
              </div>
              <button onClick={onClose} style={{ ...primaryBtnStyle, marginTop: 16 }}>
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200,
};
const modalStyle: React.CSSProperties = {
  width: 460, maxHeight: '80vh', backgroundColor: 'var(--color-bg)', borderRadius: 12,
  boxShadow: '0 20px 60px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
};
const closeBtnStyle: React.CSSProperties = {
  width: 28, height: 28, border: 'none', borderRadius: 6,
  background: 'var(--color-bg-secondary)', cursor: 'pointer', fontSize: 18,
};
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)',
  borderRadius: 6, fontSize: 14, outline: 'none',
};
const errorStyle: React.CSSProperties = {
  padding: '8px 12px', marginBottom: 14, backgroundColor: '#FEF2F2',
  color: 'var(--color-danger)', borderRadius: 6, fontSize: 13,
};
const primaryBtnStyle: React.CSSProperties = {
  width: '100%', padding: '10px 16px', backgroundColor: 'var(--color-primary)',
  color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
