import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, Provider, Task, TaskStatus } from '@orca/shared';
import { LIMITS, TASK_STATUSES, TASK_STATUS_LABELS } from '@orca/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { formatDate, formatUsd, priorityLabel } from '../lib/format';
import { uuidv4 } from '../lib/uuid';
import { useToast } from '../components/ToastProvider';
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchableSelect,
  Select,
  Spinner,
  statusTone,
  Textarea
} from '../components/ui';

interface TaskListResponse {
  data: Task[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

interface AgentListResponse {
  data: Agent[];
}

interface ProviderListResponse {
  data: Provider[];
}

interface Draft {
  title: string;
  agentId: string;
  providerId: string;
  priority: string;
  prompt: string;
}

const DRAFT_KEY = 'orca.taskDraft.v1';

const emptyForm: Draft = {
  title: '',
  agentId: '',
  providerId: '',
  priority: '2',
  prompt: ''
};

function loadDraft(): Draft | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (!parsed || typeof parsed.prompt !== 'string') return null;
    return { ...emptyForm, ...parsed };
  } catch {
    return null;
  }
}

function TaskForm({
  agents,
  providers,
  onClose,
  onCreated
}: {
  agents: Agent[];
  providers: Provider[];
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const { push } = useToast();
  const restored = useRef(loadDraft());
  const initialAgent = restored.current?.agentId || String(agents[0]?.id ?? '');
  const initialProvider =
    restored.current?.providerId ||
    String(agents.find((agent) => String(agent.id) === initialAgent)?.providerId ?? providers[0]?.id ?? '');
  const [form, setForm] = useState<Draft>(() => ({
    ...emptyForm,
    ...(restored.current ?? {}),
    agentId: initialAgent,
    providerId: initialProvider
  }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotencyKey = useRef(uuidv4());

  useEffect(() => {
    const save = (): void => {
      try {
        window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
      } catch {
        // localStorage bisa penuh/diblokir; draf bersifat best-effort
      }
    };
    save();
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [form]);

  const set = (key: keyof Draft, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const changeAgent = (value: string): void => {
    const agent = agents.find((item) => String(item.id) === value);
    setForm((current) => ({
      ...current,
      agentId: value,
      providerId: agent ? String(agent.providerId) : current.providerId
    }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFields({});
    setPending(true);
    try {
      await apiPost(
        '/tasks',
        {
          title: form.title,
          agent_id: Number(form.agentId),
          provider_id: Number(form.providerId),
          priority: Number(form.priority),
          prompt: form.prompt
        },
        { 'Idempotency-Key': idempotencyKey.current }
      );
      window.localStorage.removeItem(DRAFT_KEY);
      push('success', 'Task berhasil masuk antrean.');
      onCreated();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFields(caught.fields ?? {});
      } else {
        setError('Gagal mengirim task.');
      }
    } finally {
      setPending(false);
    }
  };

  const availableAgents = agents.filter((agent) => agent.isActive && agent.status !== 'OFFLINE');
  const availableProviders = providers.filter((provider) => provider.isActive);

  return (
    <Modal
      open
      title="Buat Task Baru"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" form="task-form" loading={pending}>
            Kirim Task
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {restored.current ? (
          <div className="rounded border border-warning bg-warning-soft px-3 py-2 text-sm">
            Draf prompt dipulihkan dari penyimpanan lokal. Draf dihapus setelah task berhasil dikirim.
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}

        <Input
          label="Judul Task"
          name="task-title"
          value={form.title}
          onChange={(event) => set('title', event.target.value)}
          error={fields.title}
          maxLength={LIMITS.taskTitleMax}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SearchableSelect
            label="Agent Tujuan"
            name="task-agent"
            value={form.agentId}
            onChange={changeAgent}
            error={fields.agent_id}
            required
            options={availableAgents.map((agent) => ({
              value: String(agent.id),
              label: `${agent.code} — ${agent.name} (${agent.status}, ${agent.activeTasksCount}/${agent.maxConcurrency})`
            }))}
          />

          <SearchableSelect
            label="Provider LLM"
            name="task-provider"
            value={form.providerId}
            onChange={(value) => set('providerId', value)}
            error={fields.provider_id}
            required
            options={availableProviders.map((provider) => ({
              value: String(provider.id),
              label: `${provider.name} (${provider.defaultModel})`
            }))}
          />
        </div>

        <Select
          label="Prioritas"
          name="task-priority"
          value={form.priority}
          onChange={(event) => set('priority', event.target.value)}
          error={fields.priority}
        >
          <option value="1">1 — Rendah</option>
          <option value="2">2 — Normal</option>
          <option value="3">3 — Tinggi</option>
        </Select>

        <Textarea
          label="Prompt Instruksi"
          name="task-prompt"
          value={form.prompt}
          onChange={(event) => set('prompt', event.target.value)}
          error={fields.prompt}
          rows={8}
          maxLength={LIMITS.promptMax}
          hint={`${form.prompt.length} / ${LIMITS.promptMax} karakter (minimal 10).`}
          required
        />

        {availableAgents.length === 0 ? (
          <p className="rounded border border-warning bg-warning-soft px-3 py-2 text-sm">
            Tidak ada agent aktif yang siap menerima task. Periksa status agent terlebih dahulu.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

export function TasksPage(): JSX.Element {
  const [items, setItems] = useState<Task[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, pageSize: 20 });
  const [agents, setAgents] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [agentFilter, setAgentFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (agentFilter) params.set('agent_id', agentFilter);
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
      params.set('page', String(page));
      const response = await apiGet<TaskListResponse>(`/tasks?${params.toString()}`);
      setItems(response.data);
      setMeta(response.meta);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, agentFilter, dateFrom, dateTo, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // EC-002: bila ada draf yang tersimpan (mis. sesi berakhir saat menulis),
    // langsung buka formulir agar draf dapat dipulihkan setelah login.
    try {
      if (window.localStorage.getItem(DRAFT_KEY)) setFormOpen(true);
    } catch {
      // abaikan
    }
  }, []);

  useEffect(() => {
    void apiGet<AgentListResponse>('/agents?page=1&page_size=100')
      .then((response) => setAgents(response.data))
      .catch(() => setAgents([]));
    void apiGet<ProviderListResponse>('/providers?page=1&page_size=100')
      .then((response) => setProviders(response.data))
      .catch(() => setProviders([]));
  }, []);

  return (
    <div>
      <PageHeader
        title="Task & Log Eksekusi"
        description="Kirim instruksi ke agent, pantau antrean, dan telusuri riwayat eksekusi."
        actions={<Button onClick={() => setFormOpen(true)}>Buat Task Baru</Button>}
      />

      <div className="card mb-4 p-4">
        <form
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            void load();
          }}
        >
          <Select label="Status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | '')}>
            <option value="">Semua status</option>
            {TASK_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TASK_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
          <Select label="Agent" value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)}>
            <option value="">Semua agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={String(agent.id)}>
                {agent.code}
              </option>
            ))}
          </Select>
          <Input label="Dari Tanggal" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          <Input label="Sampai Tanggal" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          <div className="flex items-end gap-2">
            <Button type="submit">Terapkan</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setStatus('');
                setAgentFilter('');
                setDateFrom('');
                setDateTo('');
                setPage(1);
              }}
            >
              Reset
            </Button>
          </div>
        </form>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8">
            <Spinner label="Memuat task..." />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada task yang cocok"
            description="Ubah filter atau buat task baru untuk mulai memantau eksekusi."
            action={<Button onClick={() => setFormOpen(true)}>Buat Task Baru</Button>}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Kode</th>
                    <th scope="col">Judul</th>
                    <th scope="col">Agent</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Prioritas</th>
                    <th scope="col">Status</th>
                    <th scope="col">Biaya</th>
                    <th scope="col">Dibuat</th>
                    <th scope="col">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((task) => (
                    <tr key={task.id}>
                      <td className="font-mono text-xs font-semibold">
                        <Link className="link" to={`/tasks/${task.id}`}>
                          {task.code}
                        </Link>
                      </td>
                      <td className="max-w-[240px] truncate" title={task.title}>
                        {task.title}
                      </td>
                      <td className="font-mono text-xs">{task.agentCode ?? '—'}</td>
                      <td>{task.providerName ?? '—'}</td>
                      <td>{priorityLabel(task.priority)}</td>
                      <td>
                        <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                      </td>
                      <td className="font-mono text-xs">{formatUsd(task.costUsd)}</td>
                      <td>{formatDate(task.createdAt)}</td>
                      <td>
                        <Link className="btn btn-ghost" to={`/tasks/${task.id}`}>
                          Detail
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={meta.page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
          </>
        )}
      </div>

      {formOpen ? (
        <TaskForm
          agents={agents}
          providers={providers}
          onClose={() => setFormOpen(false)}
          onCreated={() => {
            setPage(1);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
