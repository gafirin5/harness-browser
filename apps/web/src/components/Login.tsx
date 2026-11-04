import { useEffect, useState } from 'react';
import type { UserInfo } from '@dorado/shared';
import { ApiError, apiPost } from '../lib/api';

export function Login({ onLoggedIn }: { onLoggedIn: (user: UserInfo) => void }): JSX.Element {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pair = params.get('pair');
    if (!pair) return;
    setPairing(true);
    apiPost<{ data: { user: UserInfo } }>('/auth/pair', { token: pair })
      .then((response) => {
        history.replaceState(null, '', location.pathname);
        onLoggedIn(response.data.user);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof ApiError ? caught.message : 'Pairing gagal.');
      })
      .finally(() => setPairing(false));
  }, [onLoggedIn]);

  const submitPassword = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await apiPost<{ data: { user: UserInfo } }>('/auth/login', {
        username,
        password,
        ...(totpCode ? { totpCode } : {})
      });
      onLoggedIn(response.data.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Login gagal.');
    } finally {
      setPending(false);
    }
  };

  const submitToken = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const response = await apiPost<{ data: { user: UserInfo } }>('/auth/pair', { token });
      onLoggedIn(response.data.user);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Pairing gagal.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-name">Dorado</span>
        </div>
        <p className="login-sub">Agent workspace. Jalankan beberapa agent di worktree paralel dari satu layar.</p>

        {error ? <div className="error-banner">{error}</div> : null}
        {pairing ? (
          <div className="row" style={{ marginBottom: 14 }}>
            <span className="spin" /> <span className="muted">Menghubungkan pairing token...</span>
          </div>
        ) : null}

        <form onSubmit={(event) => void submitPassword(event)}>
          <div className="field">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="totp">Kode 2FA (opsional)</label>
            <input
              id="totp"
              className="input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
              placeholder="6 digit jika 2FA aktif"
            />
          </div>
          <button className="btn primary" type="submit" disabled={pending} style={{ width: '100%' }}>
            {pending ? 'Memproses...' : 'Masuk'}
          </button>
        </form>

        <div className="section-label" style={{ marginTop: 22 }}>
          Atau pairing token
        </div>
        <form onSubmit={(event) => void submitToken(event)} className="pair-box">
          <input
            className="input"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Tempel token pairing..."
            aria-label="Pairing token"
          />
          <button className="btn" type="submit" disabled={pending || !token}>
            Pair
          </button>
        </form>
        <p className="hint">
          Pairing token dibuat dari menu Share di dalam aplikasi. Token ini memberi akses penuh ke runtime.
        </p>
      </div>
    </div>
  );
}
