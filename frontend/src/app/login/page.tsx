'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, saveSession, User } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      saveSession(data.token, data.user);
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal login');
    } finally {
      setLoading(false);
    }
  }

  const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid #d4d4d8',
    borderRadius: 8,
    fontSize: 15,
    boxSizing: 'border-box',
    background: '#fff',
    color: '#18181b',
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f4f5', padding: 16 }}>
      <form onSubmit={onSubmit} style={{ width: '100%', maxWidth: 360, background: '#fff', padding: 28, borderRadius: 14, boxShadow: '0 2px 12px rgba(0,0,0,.08)', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c4a21" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
            <path d="M7 2v3M11 2v3M15 2v3" />
          </svg>
          <h1 style={{ margin: 0, fontSize: 20 }}>Cafe Inventory POS</h1>
        </div>
        <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
          Email
          <input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label style={{ display: 'grid', gap: 6, fontSize: 14 }}>
          Password
          <input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p style={{ margin: 0, color: '#b91c1c', fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={loading} style={{ padding: '10px 12px', border: 0, borderRadius: 8, background: '#7c4a21', color: '#fff', fontSize: 15, cursor: 'pointer' }}>
          {loading ? 'Masuk...' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}