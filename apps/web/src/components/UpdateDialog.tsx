import { useCallback, useEffect, useState } from 'react';
import type { UpdateResultInfo, UpdateStatusInfo } from '@dorado/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Modal, useToast } from './ui';

export function UpdateDialog({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }): JSX.Element {
  const { push } = useToast();
  const [status, setStatus] = useState<UpdateStatusInfo | null>(null);
  const [result, setResult] = useState<UpdateResultInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: UpdateStatusInfo }>('/update');
      setStatus(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memeriksa pembaruan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const apply = async (): Promise<void> => {
    if (!window.confirm('Terapkan pembaruan sekarang? Runtime akan dibangun ulang lalu di-restart.')) return;
    setApplying(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiPost<{ data: UpdateResultInfo }>('/update');
      setResult(response.data);
      if (response.data.ok) {
        push('success', 'Pembaruan selesai.');
        if (response.data.restartRequired) {
          window.setTimeout(() => window.location.reload(), 5000);
        }
      } else {
        push('error', 'Pembaruan gagal. Lihat log di bawah.');
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menerapkan pembaruan.');
    } finally {
      setApplying(false);
    }
  };

  const available = status && status.enabled && !status.error && !status.upToDate && status.behindCount > 0;

  return (
    <Modal
      title="Pembaruan Sistem"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn tiny" onClick={() => void load()} disabled={loading || applying}>
            {loading ? 'Memeriksa...' : 'Cek Pembaruan'}
          </button>
          {available ? (
            <button className="btn tiny primary" onClick={() => void apply()} disabled={applying || status?.dirty}>
              {applying ? 'Memperbarui...' : 'Update Sekarang'}
            </button>
          ) : null}
          <button className="btn" onClick={onClose}>
            Tutup
          </button>
        </>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}
      {!isAdmin ? <div className="error-banner">Hanya admin yang dapat memperbarui sistem.</div> : null}

      {status ? (
        <>
          <div className="kv">
            <span className="k">Versi saat ini</span>
            <span className="v">
              {status.currentVersion}{' '}
              <span className="mono">
                ({status.branch}@{status.currentCommit ?? '?'})
              </span>
            </span>
          </div>
          <div className="kv">
            <span className="k">Remote</span>
            <span className="v mono">{status.remote}</span>
          </div>
          <div className="kv">
            <span className="k">Restart</span>
            <span className="v mono">{status.restartCommand ?? 're-exec otomatis'}</span>
          </div>

          {status.error ? <div className="error-banner">{status.error}</div> : null}
          {status.dirty ? (
            <div className="error-banner">Working tree kotor — commit/stash dulu sebelum update.</div>
          ) : null}
          {status.enabled && !status.error && status.upToDate ? <div className="hint">Sudah versi terbaru.</div> : null}

          {available ? (
            <>
              <div className="section-label">{status.behindCount} commit baru</div>
              <div className="quick-command-list">
                {status.commits.map((commit) => (
                  <div className="quick-command-row" key={commit.hash}>
                    <div className="quick-command-info">
                      <div className="quick-command-label">
                        <span className="badge mono">{commit.hash}</span>
                        {commit.subject}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {result ? (
        <>
          <div className="section-label">Log update</div>
          <div className="quick-command-list">
            {result.steps.map((step) => (
              <div className="quick-command-row" key={step.step}>
                <div className="quick-command-info">
                  <div className="quick-command-label">
                    <span className={`badge ${step.ok ? 'completed' : 'failed'}`}>{step.ok ? 'OK' : 'GAGAL'}</span>
                    <span className="mono">{step.step}</span>
                  </div>
                  <code className="quick-command-code">{step.output.split('\n').slice(-12).join('\n')}</code>
                </div>
              </div>
            ))}
          </div>
          {result.ok && result.restartRequired ? (
            <div className="hint">Runtime akan restart; halaman ini dimuat ulang otomatis.</div>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
