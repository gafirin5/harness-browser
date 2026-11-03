import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { ApiError } from '../lib/api';
import { useToast } from '../components/ToastProvider';
import { Input, Button } from '../components/ui';

interface LocationState {
  from?: string;
}

export function LoginPage(): JSX.Element {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { push } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const from = (location.state as LocationState | null)?.from ?? '/';
  const wasRedirected = Boolean((location.state as LocationState | null)?.from);

  useEffect(() => {
    if (!loading && user) navigate(from, { replace: true });
  }, [loading, user, navigate, from]);

  if (!loading && user) return <Navigate to={from} replace />;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    if (!email.trim() || !password) {
      setError('Email dan password wajib diisi.');
      return;
    }
    setPending(true);
    try {
      await login(email.trim(), password);
      push('success', 'Berhasil masuk.');
      navigate(from, { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fields ?? {});
        if (caught.status === 423) push('error', caught.message);
      } else {
        setError('Gagal masuk. Coba lagi.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink px-4 py-10">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
        <div className="mb-6 text-center">
          <p className="text-2xl font-extrabold tracking-tight text-ink">ORCA</p>
          <p className="text-sm text-muted">Agent Orchestrator · Chrome 93 Ready</p>
        </div>

        {wasRedirected ? (
          <div role="status" className="mb-4 rounded border border-line bg-slate-50 px-3 py-2 text-sm text-ink">
            Sesi Anda telah berakhir. Draf prompt (bila ada) telah disimpan sementara. Silakan masuk kembali.
          </div>
        ) : null}

        {error ? (
          <div role="alert" className="mb-4 rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-ink">
            {error}
          </div>
        ) : null}

        <form onSubmit={(event) => void onSubmit(event)} className="space-y-4" noValidate>
          <Input
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            required
          />
          <Input
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            required
          />
          <Button type="submit" loading={pending} className="w-full">
            Masuk
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted">
          Gunakan akun Admin yang dibuat melalui seeder. Sesi berakhir otomatis setelah 8 jam tanpa aktivitas.
        </p>
      </div>
    </div>
  );
}
