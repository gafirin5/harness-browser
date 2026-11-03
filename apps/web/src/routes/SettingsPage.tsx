import { useState } from 'react';
import { useAuth } from '../features/auth/AuthContext';
import { ApiError, apiPatch } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useToast } from '../components/ToastProvider';
import { Button, Input, PageHeader } from '../components/ui';

export function SettingsPage(): JSX.Element {
  const { user } = useAuth();
  const { push } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFields({});
    if (newPassword !== confirmPassword) {
      setFields({ new_password: 'Konfirmasi password tidak sama.' });
      return;
    }
    if (newPassword.length < 8) {
      setFields({ new_password: 'Password baru minimal 8 karakter.' });
      return;
    }
    setPending(true);
    try {
      await apiPatch('/auth/password', {
        current_password: currentPassword,
        new_password: newPassword
      });
      push('success', 'Password berhasil diperbarui. Sesi lain telah diakhiri.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        const mapped: Record<string, string> = {};
        if (caught.fields?.current_password) mapped.current_password = caught.fields.current_password;
        if (caught.fields?.new_password) mapped.new_password = caught.fields.new_password;
        setFields(mapped);
      } else {
        setError('Gagal memperbarui password.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Pengaturan Keamanan"
        description="Kelola kredensial akun Admin dan tinjau status sesi aktif."
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="card p-5" aria-labelledby="account-heading">
          <h2 id="account-heading" className="mb-4 text-sm font-bold text-ink">
            Informasi Akun
          </h2>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Nama</dt>
              <dd>{user?.name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Email</dt>
              <dd>{user?.email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Peran</dt>
              <dd>{user?.role ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Login Terakhir</dt>
              <dd>{formatDateTime(user?.lastLoginAt)}</dd>
            </div>
          </dl>
          <p className="mt-4 rounded border border-line bg-slate-50 px-3 py-2 text-xs text-muted">
            Sesi berakhir otomatis setelah 8 jam tanpa aktivitas. Mengubah password akan mengakhiri semua sesi lain.
          </p>
        </section>

        <section className="card p-5" aria-labelledby="password-heading">
          <h2 id="password-heading" className="mb-4 text-sm font-bold text-ink">
            Ubah Password
          </h2>
          {error ? (
            <div role="alert" className="mb-4 rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
              {error}
            </div>
          ) : null}
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            <Input
              label="Password Saat Ini"
              name="current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              error={fields.current_password}
              required
            />
            <Input
              label="Password Baru"
              name="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              error={fields.new_password}
              hint="8-72 karakter."
              required
            />
            <Input
              label="Konfirmasi Password Baru"
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
            <Button type="submit" loading={pending}>
              Simpan Password
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}
