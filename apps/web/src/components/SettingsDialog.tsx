import { useState } from 'react';
import { ApiError, request } from '../lib/api';
import { Field, Modal, useToast } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function SettingsDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const { push } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changePassword = async (): Promise<void> => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Konfirmasi password tidak sama.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password baru minimal 8 karakter.');
      return;
    }
    setSaving(true);
    try {
      const response = await request<{ data: { revokedSessions: number } }>('/auth/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword }
      });
      push('success', `Password diperbarui. ${response.data.revokedSessions} sesi lain dicabut.`);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (caught) {
      setError(messageOf(caught, 'Gagal mengganti password.'));
    } finally {
      setSaving(false);
    }
  };

  const revokeOthers = async (): Promise<void> => {
    setRevoking(true);
    setError(null);
    try {
      const response = await request<{ data: { revoked: number } }>('/auth/sessions/revoke-others', {
        method: 'POST'
      });
      push('success', `${response.data.revoked} sesi lain dicabut.`);
    } catch (caught) {
      setError(messageOf(caught, 'Gagal mencabut sesi lain.'));
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Modal
      title="Pengaturan Keamanan"
      onClose={onClose}
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="section-label">Sesi</div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
        Sesi berlaku 8 jam tanpa aktivitas dan maksimal 24 jam. Mencabut sesi lain akan mengeluarkan browser lain yang
        masih login.
      </p>
      <button className="btn tiny" onClick={() => void revokeOthers()} disabled={revoking}>
        {revoking ? 'Mencabut...' : 'Cabut Sesi Lain'}
      </button>

      <div className="section-label">Ganti Password</div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void changePassword();
        }}
      >
        <Field label="Password saat ini">
          <input
            className="input"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </Field>
        <Field label="Password baru" hint="Minimal 8 karakter.">
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Konfirmasi password baru">
          <input
            className="input"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </Field>
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn primary" type="submit" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
