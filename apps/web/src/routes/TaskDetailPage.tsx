import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Task, TaskLog } from '@orca/shared';
import { LIMITS } from '@orca/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { formatDateTime, formatUsd, priorityLabel } from '../lib/format';
import { useToast } from '../components/ToastProvider';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Modal,
  PageHeader,
  Spinner,
  statusTone,
  Textarea
} from '../components/ui';

function MetadataItem({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function TaskDetailPage(): JSX.Element {
  const { id } = useParams();
  const taskId = Number(id);
  const navigate = useNavigate();
  const { push } = useToast();
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [hasMoreLogs, setHasMoreLogs] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const lastLogId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!Number.isInteger(taskId) || taskId <= 0) {
        setError('ID task tidak valid.');
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        const after = silent ? lastLogId.current : 0;
        const [taskResponse, logResponse] = await Promise.all([
          apiGet<{ data: Task }>(`/tasks/${taskId}`),
          apiGet<{ data: TaskLog[] }>(`/tasks/${taskId}/logs?after_id=${after}&limit=100`)
        ]);
        const batch = logResponse.data;
        setTask(taskResponse.data);
        if (silent) {
          if (batch.length > 0) setLogs((current) => [...current, ...batch]);
        } else {
          setLogs(batch);
        }
        if (batch.length > 0) {
          lastLogId.current = batch[batch.length - 1]?.id ?? lastLogId.current;
        } else if (!silent) {
          lastLogId.current = 0;
        }
        setHasMoreLogs(batch.length === 100);
        setError(null);
      } catch (caught) {
        setError((caught as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [taskId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const status = task?.status;
  useEffect(() => {
    if (!status || !['QUEUED', 'RUNNING'].includes(status)) return undefined;
    const timer = window.setInterval(() => void load(true), 2000);
    return () => window.clearInterval(timer);
  }, [status, load]);

  const loadMoreLogs = async (): Promise<void> => {
    setLoadingMore(true);
    try {
      const response = await apiGet<{ data: TaskLog[] }>(
        `/tasks/${taskId}/logs?after_id=${lastLogId.current}&limit=100`
      );
      const batch = response.data;
      if (batch.length > 0) {
        setLogs((current) => [...current, ...batch]);
        lastLogId.current = batch[batch.length - 1]?.id ?? lastLogId.current;
      }
      setHasMoreLogs(batch.length === 100);
    } catch (caught) {
      push('error', (caught as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  const cancel = async (): Promise<void> => {
    setReasonError(null);
    if (reason.trim().length < LIMITS.cancelReasonMin) {
      setReasonError('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    setPending(true);
    try {
      await apiPost(`/tasks/${taskId}/cancel`, { reason: reason.trim() });
      push('success', 'Task berhasil dibatalkan.');
      setCancelOpen(false);
      setReason('');
      await load(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.fields?.reason) setReasonError(caught.fields.reason);
      else push('error', (caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  const retry = async (): Promise<void> => {
    setPending(true);
    try {
      const response = await apiPost<{ data: Task }>(`/tasks/${taskId}/retry`);
      push('success', 'Task baru berhasil masuk antrean.');
      setRetryOpen(false);
      navigate(`/tasks/${response.data.id}`);
    } catch (caught) {
      push('error', (caught as Error).message);
    } finally {
      setPending(false);
    }
  };

  const copyLogs = async (): Promise<void> => {
    const text = logs
      .map(
        (log) =>
          `${formatDateTime(log.createdAt)} [${log.logLevel}] ${log.actorType} ${log.fromStatus ?? '—'} → ${log.toStatus}: ${log.message}`
      )
      .join('\n');
    const ok = await copyText(text || 'Tidak ada log.');
    push(ok ? 'success' : 'error', ok ? 'Log berhasil disalin ke clipboard.' : 'Gagal menyalin log.');
  };

  if (loading && !task) {
    return (
      <div className="card p-8">
        <Spinner label="Memuat detail task..." />
      </div>
    );
  }

  if (error && !task) {
    return (
      <div>
        <ErrorBanner message={error} onRetry={() => void load()} />
        <Link className="link" to="/tasks">
          Kembali ke daftar task
        </Link>
      </div>
    );
  }

  if (!task) return <EmptyState title="Task tidak ditemukan" />;

  const canCancel = task.status === 'QUEUED' || task.status === 'RUNNING';
  const canRetry = task.status === 'FAILED' || task.status === 'CANCELLED';

  return (
    <div>
      <PageHeader
        title={`Detail Task ${task.code}`}
        description={task.title}
        actions={
          <>
            <Link className="btn btn-secondary" to="/tasks">
              Kembali
            </Link>
            {canCancel ? (
              <Button variant="danger" onClick={() => setCancelOpen(true)}>
                Batalkan Task
              </Button>
            ) : null}
            {canRetry ? (
              <Button onClick={() => setRetryOpen(true)}>Jalankan Ulang (Retry)</Button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="card p-5" aria-labelledby="meta-heading">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 id="meta-heading" className="text-sm font-bold text-ink">
              Metadata Task
            </h2>
            <Badge tone={statusTone(task.status)}>{task.status}</Badge>
          </div>

          <dl className="grid grid-cols-2 gap-4">
            <MetadataItem label="Kode">
              <span className="font-mono text-xs">{task.code}</span>
            </MetadataItem>
            <MetadataItem label="Prioritas">{priorityLabel(task.priority)}</MetadataItem>
            <MetadataItem label="Agent">
              <span className="font-mono text-xs">{task.agentCode ?? '—'}</span>
              {task.agentActive === false ? <span className="ml-1 text-xs text-muted">(Nonaktif)</span> : null}
            </MetadataItem>
            <MetadataItem label="Provider">
              {task.providerName ?? '—'}
              {task.providerActive === false ? <span className="ml-1 text-xs text-muted">(Nonaktif)</span> : null}
            </MetadataItem>
            <MetadataItem label="Token Terpakai">{task.tokenUsed}</MetadataItem>
            <MetadataItem label="Biaya USD">
              <span className="font-mono">{formatUsd(task.costUsd)}</span>
            </MetadataItem>
            <MetadataItem label="Tarif Snapshot / 1K">
              <span className="font-mono">{formatUsd(task.costPer1kSnapshot)}</span>
            </MetadataItem>
            <MetadataItem label="Retry Dari">
              {task.retryOfTaskId ? (
                <Link className="link font-mono text-xs" to={`/tasks/${task.retryOfTaskId}`}>
                  #{task.retryOfTaskId}
                </Link>
              ) : (
                '—'
              )}
            </MetadataItem>
            <MetadataItem label="Dibuat">{formatDateTime(task.createdAt)}</MetadataItem>
            <MetadataItem label="Mulai">{formatDateTime(task.startedAt)}</MetadataItem>
            <MetadataItem label="Selesai">{formatDateTime(task.finishedAt)}</MetadataItem>
          </dl>

          {task.cancelReason ? (
            <div className="mt-4 rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
              <strong>Alasan pembatalan:</strong> {task.cancelReason}
            </div>
          ) : null}
          {task.errorMessage ? (
            <div className="mt-4 rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
              <strong>Error:</strong> {task.errorMessage}
            </div>
          ) : null}
          {task.result ? (
            <div className="mt-4">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Hasil</h3>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded border border-line bg-slate-50 p-3 text-xs">
                {task.result}
              </pre>
            </div>
          ) : null}

          <div className="mt-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Prompt Instruksi</h3>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border border-line bg-slate-50 p-3 text-xs">
              {task.prompt}
            </pre>
          </div>
        </section>

        <section className="card overflow-hidden" aria-labelledby="log-heading">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id="log-heading" className="text-sm font-bold text-ink">
              Log Eksekusi
            </h2>
            <div className="flex flex-wrap gap-2">
              {hasMoreLogs ? (
                <Button variant="secondary" onClick={() => void loadMoreLogs()} loading={loadingMore}>
                  Muat Log Berikutnya
                </Button>
              ) : null}
              <Button variant="secondary" onClick={() => void copyLogs()}>
                Salin Log
              </Button>
              <Button variant="secondary" onClick={() => void load(true)}>
                Muat Ulang
              </Button>
            </div>
          </div>
          <div className="console max-h-[32rem] overflow-auto p-4" role="log" aria-live="polite">
            {logs.length === 0 ? (
              <p className="text-slate-300">Belum ada log untuk task ini.</p>
            ) : (
              <ol className="space-y-1">
                {logs.map((log) => (
                  <li key={log.id} className="break-words">
                    <span className="text-slate-400">[{formatDateTime(log.createdAt)}]</span>{' '}
                    <span
                      className={
                        log.logLevel === 'ERROR'
                          ? 'text-red-300'
                          : log.logLevel === 'WARN'
                            ? 'text-yellow-300'
                            : 'text-green-300'
                      }
                    >
                      {log.logLevel}
                    </span>{' '}
                    <span className="text-slate-400">
                      {log.actorType} {log.fromStatus ?? '—'} → {log.toStatus}
                    </span>
                    : {log.message}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            Menampilkan {logs.length} log. Log append-only dan tidak dapat diubah.
          </p>
        </section>
      </div>

      <Modal
        open={cancelOpen}
        title="Batalkan Task"
        onClose={() => setCancelOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={pending}>
              Kembali
            </Button>
            <Button variant="danger" onClick={() => void cancel()} loading={pending}>
              Konfirmasi Pembatalan
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Task <strong className="font-mono">{task.code}</strong> akan dibatalkan. Tindakan ini tidak dapat
            dibatalkan.
          </p>
          <Textarea
            label="Alasan Pembatalan"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError ?? undefined}
            rows={4}
            maxLength={LIMITS.cancelReasonMax}
            hint="Wajib diisi 5-255 karakter."
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={retryOpen}
        title="Jalankan Ulang Task"
        message={
          <>
            Task <strong className="font-mono">{task.code}</strong> akan diduplikasi menjadi task baru berstatus
            QUEUED dengan snapshot tarif terkini. Task lama tetap tersimpan sebagai riwayat.
          </>
        }
        confirmLabel="Jalankan Ulang"
        pending={pending}
        onConfirm={() => void retry()}
        onClose={() => setRetryOpen(false)}
      />
    </div>
  );
}
