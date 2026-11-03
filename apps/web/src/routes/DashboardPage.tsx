import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatUsd4, type DashboardSummary } from '@orca/shared';
import { apiGet } from '../lib/api';
import { useSummaryStream, type StreamMode } from '../lib/useSummaryStream';
import { formatDateTime, relativeSince } from '../lib/format';
import { Badge, Button, EmptyState, ErrorBanner, PageHeader, Spinner, statusTone } from '../components/ui';

function SummaryCard({
  metric,
  label,
  value,
  hint
}: {
  metric: string;
  label: string;
  value: string;
  hint: string;
}): JSX.Element {
  return (
    <div className="card p-4" data-testid={`summary-${metric}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-ink" data-testid="summary-value">
        {value}
      </p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

export function DashboardPage(): JSX.Element {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mode: StreamMode = useSummaryStream(useCallback((next) => setSummary(next), []));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: DashboardSummary }>('/dashboard/summary');
      setSummary(response.data);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        title="Dashboard Orkestrasi"
        description="Ringkasan beban kerja agent, biaya token harian, dan peringatan kegagalan."
        actions={
          <>
            <Button variant="secondary" onClick={() => void load()}>
              Muat Ulang
            </Button>
            <Button onClick={() => navigate('/tasks')}>Buat Task Baru</Button>
          </>
        }
      />

      {mode === 'polling' ? (
        <div role="status" className="mb-4 rounded border border-warning bg-warning-soft px-4 py-2 text-sm text-ink">
          Koneksi stream terputus, beralih ke mode pembaruan berkala (2 detik).
        </div>
      ) : null}

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {loading && !summary ? (
        <div className="card p-8">
          <Spinner label="Memuat data orkestrasi..." />
        </div>
      ) : summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard metric="agents" label="Agent Aktif" value={String(summary.agentsActive)} hint="IDLE + BUSY" />
            <SummaryCard metric="running" label="Task Berjalan" value={String(summary.tasksRunning)} hint="Status RUNNING" />
            <SummaryCard
              metric="failed"
              label="Task Gagal Hari Ini"
              value={String(summary.tasksFailedToday)}
              hint="Berdasarkan waktu selesai"
            />
            <SummaryCard metric="cost" label="Biaya Hari Ini" value={formatUsd4(summary.costTodayUsd)} hint="Task COMPLETED" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <section className="card overflow-hidden" aria-labelledby="alerts-heading">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 id="alerts-heading" className="text-sm font-bold text-ink">
                  Peringatan
                </h2>
                <span className="text-xs text-muted">{summary.alerts.length} item</span>
              </div>
              {summary.alerts.length === 0 ? (
                <EmptyState title="Tidak ada peringatan aktif" description="Semua agent merespons dan tidak ada task gagal hari ini." />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Tipe</th>
                        <th scope="col">Referensi</th>
                        <th scope="col">Sejak</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.alerts.map((alert) => (
                        <tr key={`${alert.type}-${alert.id}`}>
                          <td>
                            <Badge tone={alert.type === 'AGENT_OFFLINE' ? 'danger' : 'warning'}>
                              {alert.type === 'AGENT_OFFLINE' ? 'Agent OFFLINE' : 'Task FAILED'}
                            </Badge>
                          </td>
                          <td>
                            {alert.type === 'TASK_FAILED' ? (
                              <Link className="link font-mono text-xs" to={`/tasks/${alert.id}`}>
                                {alert.label}
                              </Link>
                            ) : (
                              <span className="font-mono text-xs">{alert.label}</span>
                            )}
                          </td>
                          <td title={formatDateTime(alert.since)}>{relativeSince(alert.since)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card overflow-hidden" aria-labelledby="activity-heading">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 id="activity-heading" className="text-sm font-bold text-ink">
                  Aktivitas Terbaru
                </h2>
                <span className="text-xs text-muted">10 log terakhir</span>
              </div>
              {summary.recentLogs.length === 0 ? (
                <EmptyState
                  title="Belum ada task yang tercatat hari ini."
                  description="Buat task pertama untuk mulai memantau aktivitas agent."
                  action={<Button onClick={() => navigate('/tasks')}>Buat Task Baru</Button>}
                />
              ) : (
                <ul className="divide-y divide-line">
                  {summary.recentLogs.map((log) => (
                    <li key={log.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={statusTone(log.logLevel === 'ERROR' ? 'FAILED' : log.logLevel === 'WARN' ? 'RUNNING' : 'COMPLETED')}>
                          {log.logLevel}
                        </Badge>
                        <Link className="link font-mono text-xs" to={`/tasks/${log.taskId}`}>
                          {log.taskCode}
                        </Link>
                        <span className="ml-auto text-xs text-muted" title={formatDateTime(log.createdAt)}>
                          {relativeSince(log.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-sm text-ink">{log.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
