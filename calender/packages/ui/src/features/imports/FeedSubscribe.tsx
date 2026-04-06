import React, { useState } from 'react';
import { Rss, RefreshCw, Trash2, AlertCircle, Check, Loader2 } from 'lucide-react';
import { useImportSources, useSubscribeFeed, useSyncFeed, useDeleteFeed } from './useImports';
import type { ImportSource } from '@calendar/types';

interface FeedSubscribeProps {
  onClose: () => void;
}

export function FeedSubscribe({ onClose }: FeedSubscribeProps) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const { data: sources = [], isLoading } = useImportSources();
  const subscribeMutation = useSubscribeFeed();
  const syncMutation = useSyncFeed();
  const deleteMutation = useDeleteFeed();

  const feedSources = sources.filter((s) => s.sourceType === 'ics_feed');

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!url.trim()) return;

    try {
      await subscribeMutation.mutateAsync({ url: url.trim(), name: name.trim() || undefined });
      setUrl('');
      setName('');
    } catch (err: any) {
      setError(err.message || 'Failed to subscribe');
    }
  }

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalStyle}>
        <div style={headerStyle}>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Feed Subscriptions</h2>
          <button onClick={onClose} style={closeBtnStyle}>×</button>
        </div>

        <div style={{ padding: '16px 20px', overflow: 'auto', flex: 1 }}>
          {error && <div style={errorBoxStyle}>{error}</div>}

          {/* Subscribe form */}
          <form onSubmit={handleSubscribe} style={{ marginBottom: 20 }}>
            <div style={{ marginBottom: 10 }}>
              <label style={labelStyle}>Feed URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/calendar.ics"
                required
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Name (optional)</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Feed"
                style={inputStyle}
              />
            </div>
            <button
              type="submit"
              disabled={subscribeMutation.isPending}
              style={{
                ...primaryBtnStyle,
                opacity: subscribeMutation.isPending ? 0.7 : 1,
              }}
            >
              <Rss size={14} />
              {subscribeMutation.isPending ? 'Subscribing...' : 'Subscribe'}
            </button>
          </form>

          {/* Existing subscriptions */}
          {feedSources.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', marginBottom: 8 }}>
                Active Subscriptions
              </h3>
              {feedSources.map((source) => (
                <FeedSourceCard
                  key={source.id}
                  source={source}
                  onSync={() => syncMutation.mutate(source.id)}
                  onDelete={() => deleteMutation.mutate(source.id)}
                  isSyncing={syncMutation.isPending}
                />
              ))}
            </div>
          )}

          {feedSources.length === 0 && !isLoading && (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-secondary)', fontSize: 13 }}>
              No feed subscriptions yet. Add one above.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FeedSourceCard({
  source,
  onSync,
  onDelete,
  isSyncing,
}: {
  source: ImportSource;
  onSync: () => void;
  onDelete: () => void;
  isSyncing: boolean;
}) {
  const statusColor = source.status === 'active' ? 'var(--color-success)' :
    source.status === 'error' ? 'var(--color-danger)' : 'var(--color-text-secondary)';

  const StatusIcon = source.status === 'active' ? Check :
    source.status === 'error' ? AlertCircle : Loader2;

  return (
    <div style={{
      padding: '10px 12px', marginBottom: 8, borderRadius: 8,
      border: '1px solid var(--color-border)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {source.sourceUrl}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <StatusIcon size={12} style={{ color: statusColor }} />
            <span style={{ fontSize: 12, color: statusColor }}>
              {source.status}
            </span>
            {source.lastSuccessAt && (
              <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                · Last synced {new Date(source.lastSuccessAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {source.errorMessage && (
            <div style={{ fontSize: 12, color: 'var(--color-danger)', marginTop: 4 }}>
              {source.errorMessage}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
          <IconButton onClick={onSync} disabled={isSyncing} aria-label="Sync now">
            <RefreshCw size={14} style={isSyncing ? { animation: 'spin 1s linear infinite' } : {}} />
          </IconButton>
          <IconButton onClick={onDelete} aria-label="Remove feed" danger>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function IconButton({
  children,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      {...props}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, border: 'none', borderRadius: 6,
        background: danger ? '#FEF2F2' : 'var(--color-bg-secondary)',
        color: danger ? 'var(--color-danger)' : 'var(--color-text-secondary)',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
  backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 200,
};
const modalStyle: React.CSSProperties = {
  width: 500, maxHeight: '80vh', backgroundColor: 'var(--color-bg)', borderRadius: 12,
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
const errorBoxStyle: React.CSSProperties = {
  padding: '8px 12px', marginBottom: 14, backgroundColor: '#FEF2F2',
  color: 'var(--color-danger)', borderRadius: 6, fontSize: 13,
};
const primaryBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  width: '100%', padding: '9px 16px', backgroundColor: 'var(--color-primary)',
  color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer',
};
