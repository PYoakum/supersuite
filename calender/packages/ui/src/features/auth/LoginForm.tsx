import React, { useState } from 'react';
import { useAuthStore } from '../../state/calendar-store';
import { api } from '../../lib/api-client';

export function LoginForm() {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setTokens } = useAuthStore();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const endpoint = isRegister ? '/auth/register' : '/auth/login';
      const body = isRegister
        ? { email, password, name }
        : { email, password };

      const res = await fetch(`http://localhost:3100/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Request failed');

      setTokens(data.accessToken, data.refreshToken);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', backgroundColor: 'var(--color-bg)',
    }}>
      <div style={{
        width: 360, padding: 32,
        borderRadius: 12, border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-bg)',
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Calendar</h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          {isRegister ? 'Create your account' : 'Sign in to continue'}
        </p>

        {error && (
          <div style={{
            padding: '8px 12px', marginBottom: 16,
            backgroundColor: '#FEF2F2', color: 'var(--color-danger)',
            borderRadius: 6, fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={inputStyle}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '10px 16px',
              backgroundColor: 'var(--color-primary)', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Please wait...' : isRegister ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <button
          onClick={() => { setIsRegister(!isRegister); setError(''); }}
          style={{
            display: 'block', margin: '16px auto 0', padding: 0,
            border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 13, color: 'var(--color-primary)',
          }}
        >
          {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register"}
        </button>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 500,
  color: 'var(--color-text-secondary)', marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--color-border)', borderRadius: 6,
  fontSize: 14, outline: 'none',
};
