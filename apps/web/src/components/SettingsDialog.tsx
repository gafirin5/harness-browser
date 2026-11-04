import { useCallback, useEffect, useState } from 'react';
import type { UserInfo, UserRole } from '@dorado/shared';
import { ApiError, request } from '../lib/api';
import { Field, Modal, useToast } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function SettingsDialog({
  onClose,
  currentUser,
  onUserUpdated
}: {
  onClose: () => void;
  currentUser: UserInfo;
  onUserUpdated?: (user: UserInfo) => void;
}): JSX.Element {
  const { push } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [totpEnabled, setTotpEnabled] = useState(currentUser.totpEnabled);
  const [totpSetup, setTotpSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    qrDataUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);

  const [users, setUsers] = useState<UserInfo[]>([]);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('VIEWER');

  const isAdmin = currentUser.role === 'ADMIN';

  const loadUsers = useCallback(async (): Promise<void> => {
    if (!isAdmin) return;
    try {
      const response = await request<{ data: UserInfo[] }>('/users');
      setUsers(response.data);
      setUsersError(null);
    } catch (caught) {
      setUsersError(messageOf(caught, 'Gagal memuat daftar user.'));
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

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

  const startTotpSetup = async (): Promise<void> => {
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      const response = await request<{ data: { secret: string; otpauthUrl: string; qrDataUrl: string } }>(
        '/auth/2fa/setup',
        { method: 'POST' }
      );
      setTotpSetup(response.data);
      setTotpCode('');
    } catch (caught) {
      setTwoFactorError(messageOf(caught, 'Gagal memulai setup 2FA.'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const confirmTotpSetup = async (): Promise<void> => {
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      await request('/auth/2fa/confirm', { method: 'POST', body: { code: totpCode } });
      setTotpEnabled(true);
      setTotpSetup(null);
      setTotpCode('');
      onUserUpdated?.({ ...currentUser, totpEnabled: true });
      push('success', '2FA berhasil diaktifkan.');
    } catch (caught) {
      setTwoFactorError(messageOf(caught, 'Kode 2FA tidak valid.'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const disableTotpNow = async (): Promise<void> => {
    setTwoFactorBusy(true);
    setTwoFactorError(null);
    try {
      await request('/auth/2fa/disable', {
        method: 'POST',
        body: { password: disablePassword, code: disableCode }
      });
      setTotpEnabled(false);
      setDisablePassword('');
      setDisableCode('');
      onUserUpdated?.({ ...currentUser, totpEnabled: false });
      push('success', '2FA dinonaktifkan.');
    } catch (caught) {
      setTwoFactorError(messageOf(caught, 'Gagal menonaktifkan 2FA.'));
    } finally {
      setTwoFactorBusy(false);
    }
  };

  const resetUserTotp = async (user: UserInfo): Promise<void> => {
    try {
      await request(`/users/${user.id}/2fa-disable`, { method: 'POST' });
      push('success', `2FA ${user.username} dinonaktifkan.`);
      await loadUsers();
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal menonaktifkan 2FA user.'));
    }
  };

  const createUser = async (): Promise<void> => {
    setUsersError(null);
    if (newUserPassword.length < 8) {
      setUsersError('Password user minimal 8 karakter.');
      return;
    }
    setCreating(true);
    try {
      await request('/users', {
        method: 'POST',
        body: { username: newUsername, name: newName, password: newUserPassword, role: newRole }
      });
      push('success', 'User berhasil dibuat.');
      setNewUsername('');
      setNewName('');
      setNewUserPassword('');
      setNewRole('VIEWER');
      await loadUsers();
    } catch (caught) {
      setUsersError(messageOf(caught, 'Gagal membuat user.'));
    } finally {
      setCreating(false);
    }
  };

  const toggleUser = async (user: UserInfo): Promise<void> => {
    try {
      await request(`/users/${user.id}`, {
        method: 'PATCH',
        body: { isActive: !user.isActive }
      });
      push('success', `User ${user.username} ${user.isActive ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await loadUsers();
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal mengubah user.'));
    }
  };

  const resetPassword = async (user: UserInfo): Promise<void> => {
    const value = window.prompt(`Password baru untuk ${user.username} (minimal 8 karakter):`);
    if (!value || value.length < 8) return;
    try {
      await request(`/users/${user.id}/reset-password`, {
        method: 'POST',
        body: { newPassword: value }
      });
      push('success', `Password ${user.username} berhasil direset.`);
    } catch (caught) {
      push('error', messageOf(caught, 'Gagal mereset password user.'));
    }
  };

  return (
    <Modal
      title="Pengaturan Keamanan"
      onClose={onClose}
      wide
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

      <div className="section-label">Autentikasi Dua Faktor</div>
      {twoFactorError ? <div className="error-banner">{twoFactorError}</div> : null}
      {totpEnabled ? (
        <div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
            2FA aktif. Untuk menonaktifkan, masukkan password dan kode 6 digit saat ini.
          </p>
          <div className="orch-form">
            <Field label="Password">
              <input
                className="input"
                type="password"
                value={disablePassword}
                onChange={(event) => setDisablePassword(event.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="Kode 2FA">
              <input
                className="input"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <div className="orch-form-actions">
              <button className="btn tiny" onClick={() => void disableTotpNow()} disabled={twoFactorBusy}>
                {twoFactorBusy ? 'Memproses...' : 'Nonaktifkan 2FA'}
              </button>
            </div>
          </div>
        </div>
      ) : totpSetup ? (
        <div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
            Scan QR dengan aplikasi authenticator, lalu masukkan kode 6 digit.
          </p>
          <img className="totp-qr" src={totpSetup.qrDataUrl} alt="QR 2FA" />
          <p className="mono" style={{ wordBreak: 'break-all', fontSize: 10.5 }}>
            {totpSetup.secret}
          </p>
          <div className="row">
            <input
              className="input"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, ''))}
              placeholder="Kode 6 digit"
              aria-label="Kode konfirmasi 2FA"
            />
            <button className="btn tiny primary" onClick={() => void confirmTotpSetup()} disabled={twoFactorBusy}>
              {twoFactorBusy ? 'Memproses...' : 'Konfirmasi 2FA'}
            </button>
            <button className="btn tiny" onClick={() => setTotpSetup(null)} disabled={twoFactorBusy}>
              Batal
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 0 }}>
            2FA belum aktif. Aktifkan untuk mewajibkan kode authenticator saat login.
          </p>
          <button className="btn tiny" onClick={() => void startTotpSetup()} disabled={twoFactorBusy}>
            {twoFactorBusy ? 'Menyiapkan...' : 'Aktifkan 2FA'}
          </button>
        </div>
      )}

      {isAdmin ? (
        <>
          <div className="section-label">Pengguna</div>
          {usersError ? <div className="error-banner">{usersError}</div> : null}
          <div className="orch-table-wrap">
            <table className="orch-table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Nama</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>2FA</th>
                  <th>Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="mono">{user.username}</td>
                    <td>{user.name}</td>
                    <td>
                      <span className={`badge ${user.role === 'ADMIN' ? 'completed' : 'idle'}`}>{user.role}</span>
                    </td>
                    <td>
                      <span className={`badge ${user.isActive ? 'active' : 'inactive'}`}>
                        {user.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${user.totpEnabled ? 'active' : 'inactive'}`}>
                        {user.totpEnabled ? 'ON' : 'OFF'}
                      </span>
                    </td>
                    <td className="orch-actions">
                      <button className="btn tiny" onClick={() => void resetPassword(user)}>
                        Reset Password
                      </button>
                      {user.totpEnabled ? (
                        <button className="btn tiny" onClick={() => void resetUserTotp(user)}>
                          Reset 2FA
                        </button>
                      ) : null}
                      <button className="btn tiny" onClick={() => void toggleUser(user)}>
                        {user.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <form
            className="orch-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createUser();
            }}
          >
            <Field label="Username">
              <input
                className="input"
                value={newUsername}
                onChange={(event) => setNewUsername(event.target.value)}
                required
              />
            </Field>
            <Field label="Nama">
              <input className="input" value={newName} onChange={(event) => setNewName(event.target.value)} required />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Field label="Role">
              <select
                className="select"
                value={newRole}
                onChange={(event) => setNewRole(event.target.value as UserRole)}
              >
                <option value="VIEWER">Viewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="orch-form-actions">
              <button className="btn tiny primary" type="submit" disabled={creating}>
                {creating ? 'Menyimpan...' : 'Tambah User'}
              </button>
            </div>
          </form>
        </>
      ) : (
        <p className="muted" style={{ fontSize: 11.5 }}>
          Mode viewer: pengelolaan user hanya tersedia untuk admin.
        </p>
      )}
    </Modal>
  );
}
