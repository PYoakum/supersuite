import React from 'react';
import { X } from 'lucide-react';

interface KeyboardShortcutsHelpProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ['T'], description: 'Go to today' },
  { keys: ['M'], description: 'Month view' },
  { keys: ['W'], description: 'Week view' },
  { keys: ['D'], description: 'Day view' },
  { keys: ['N'], description: 'New event' },
  { keys: ['←'], description: 'Previous period' },
  { keys: ['→'], description: 'Next period' },
  { keys: ['Esc'], description: 'Close modal' },
];

export function KeyboardShortcutsHelp({ onClose }: KeyboardShortcutsHelpProps) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 300,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        style={{
          width: 360,
          backgroundColor: 'var(--color-bg)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          overflow: 'hidden',
          animation: 'slideUp 0.2s ease-out',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 28, height: 28, border: 'none', borderRadius: 6,
              background: 'var(--color-bg-secondary)', cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '12px 20px' }}>
          {SHORTCUTS.map((shortcut, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 0',
                borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--color-border)' : 'none',
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
                {shortcut.description}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 28,
                      height: 26,
                      padding: '0 6px',
                      backgroundColor: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 5,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'inherit',
                      color: 'var(--color-text)',
                    }}
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
