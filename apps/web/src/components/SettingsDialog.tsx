import { useCallback, useEffect, useState } from 'react';
import type { UserInfo, UserRole } from '@dorado/shared';
import { ApiError, request } from '../lib/api';
import { Field, Modal, useToast } from './ui';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function SettingsDialog({ onClose, currentUser }: { onClose: () => void; currentUser: UserInfo }): JSX.Element {
  const { push } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
                    <td className="orch-actions">
                      <button className="btn tiny" onClick={() => void resetPassword(user)}>
                        Reset Password
                      </button>
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
