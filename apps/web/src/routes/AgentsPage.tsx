import { useCallback, useEffect, useState } from 'react';
import type { Agent, Provider } from '@orca/shared';
import { ApiError, apiGet, apiPatch, apiPost } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { useToast } from '../components/ToastProvider';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchableSelect,
  Spinner,
  statusTone
} from '../components/ui';

interface ListResponse {
  data: Agent[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

interface ProviderListResponse {
  data: Provider[];
}

function AgentForm({
  agent,
  providers,
  onClose,
  onSaved
}: {
  agent: Agent | null;
  providers: Provider[];
  onClose: () => void;
  onSaved: (created?: { token: string; code: string }) => void;
}): JSX.Element {
  const { push } = useToast();
  const firstProvider = providers.find((provider) => provider.isActive);
  const [form, setForm] = useState(() => ({
    code: agent?.code ?? '',
    name: agent?.name ?? '',
    endpoint_url: agent?.endpointUrl ?? '',
    provider_id: String(agent?.providerId ?? firstProvider?.id ?? ''),
    max_concurrency: String(agent?.maxConcurrency ?? 1)
  }));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const set = (key: keyof typeof form, value: string): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setFields({});
    setPending(true);
    try {
      if (agent) {
        await apiPatch(`/agents/${agent.id}`, {
          name: form.name,
          endpoint_url: form.endpoint_url,
          provider_id: Number(form.provider_id),
          max_concurrency: Number(form.max_concurrency)
        });
        push('success', 'Agent berhasil diperbarui.');
        onSaved();
      } else {
        const response = await apiPost<{ data: Agent; agentToken: string }>('/agents', {
          code: form.code,
          name: form.name,
          endpoint_url: form.endpoint_url,
          provider_id: Number(form.provider_id),
          max_concurrency: Number(form.max_concurrency)
        });
        push('success', 'Agent berhasil didaftarkan.');
        onSaved({ token: response.agentToken, code: response.data.code });
      }
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.status === 409 && caught.message.includes('Kode agent')) {
          setFields({ code: caught.message });
        } else {
          setFields(caught.fields ?? {});
        }
      } else {
        setError('Gagal menyimpan agent.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      title={agent ? 'Ubah Agent' : 'Daftarkan Agent'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" form="agent-form" loading={pending}>
            Simpan Agent
          </Button>
        </>
      }
    >
      <form id="agent-form" onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        <Input
          label="Kode Agent"
          name="agent-code"
          value={form.code}
          onChange={(event) => set('code', event.target.value)}
          error={fields.code}
          placeholder="AGT-CODER-01"
          maxLength={20}
          disabled={Boolean(agent)}
          hint={agent ? 'Kode agent tidak dapat diubah.' : '3-20 karakter alfanumerik atau tanda hubung.'}
          required
        />
        <Input
          label="Nama Agent"
          name="agent-name"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          error={fields.name}
          maxLength={100}
          required
        />
        <Input
          label="Endpoint URL"
          name="agent-endpoint"
          value={form.endpoint_url}
          onChange={(event) => set('endpoint_url', event.target.value)}
          error={fields.endpoint_url}
          placeholder="http://192.168.1.10:9100"
          maxLength={255}
          required
        />
        <SearchableSelect
          label="Provider Default"
          name="agent-provider"
          value={form.provider_id}
          onChange={(value) => set('provider_id', value)}
          error={fields.provider_id}
          required
          options={providers.map((provider) => ({
            value: String(provider.id),
            label: `${provider.name} ${provider.isActive ? '' : '(Nonaktif)'}`,
            disabled: !provider.isActive
          }))}
        />
        <Input
          label="Batas Konkurensi"
          name="agent-concurrency"
          type="number"
          min={1}
          max={10}
          value={form.max_concurrency}
          onChange={(event) => set('max_concurrency', event.target.value)}
          error={fields.max_concurrency}
          hint="Bilangan bulat 1-10."
          required
        />
      </form>
    </Modal>
  );
}

function TokenModal({
  token,
  agentCode,
  onClose
}: {
  token: string;
  agentCode: string;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  return (
    <Modal
      open
      title="Token Agent"
      onClose={onClose}
      footer={<Button onClick={onClose}>Selesai</Button>}
    >
      <div className="space-y-3 text-sm">
        <p className="rounded border border-warning bg-warning-soft px-3 py-2">
          Simpan token ini sekarang. Token hanya ditampilkan sekali dan dipakai agent untuk mengautentikasi dispatch
          serta callback.
        </p>
        <p>
          Agent: <strong className="font-mono">{agentCode}</strong>
        </p>
        <textarea
          readOnly
          className="input font-mono text-xs"
          rows={3}
          value={token}
          aria-label="Token agent"
        />
        <Button
          variant="secondary"
          onClick={() => {
            void copyText(token).then((ok) => {
              push(ok ? 'success' : 'error', ok ? 'Token berhasil disalin ke clipboard.' : 'Gagal menyalin token.');
            });
          }}
        >
          Salin Token
        </Button>
      </div>
    </Modal>
  );
}

export function AgentsPage(): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<Agent[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [deactivating, setDeactivating] = useState<Agent | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState(false);
  const [newToken, setNewToken] = useState<{ token: string; code: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      params.set('page', String(page));
      const response = await apiGet<ListResponse>(`/agents?${params.toString()}`);
      setItems(response.data);
      setMeta(response.meta);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  const loadProviders = useCallback(async () => {
    try {
      const response = await apiGet<ProviderListResponse>('/providers?page=1&page_size=100');
      setProviders(response.data);
    } catch {
      setProviders([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const deactivate = async (): Promise<void> => {
    if (!deactivating) return;
    setPendingDeactivate(true);
    try {
      await apiPatch(`/agents/${deactivating.id}`, { is_active: false });
      push('success', 'Agent berhasil dinonaktifkan.');
      setDeactivating(null);
      await load();
    } catch (caught) {
      push('error', (caught as Error).message);
    } finally {
      setPendingDeactivate(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Manajemen Agent Pekerja"
        description="Daftarkan worker agent dan atur kapasitas konkurensi eksekusi task."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            Daftarkan Agent
          </Button>
        }
      />

      <div className="card mb-4 p-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
        >
          <div className="min-w-[240px] flex-1">
            <label htmlFor="agent-search" className="field-label">
              Cari agent
            </label>
            <input
              id="agent-search"
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Kode atau nama agent..."
            />
          </div>
          <Button type="submit">Cari</Button>
          {query ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setQuery('');
                setPage(1);
              }}
            >
              Reset
            </Button>
          ) : null}
        </form>
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8">
            <Spinner label="Memuat agent..." />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada agent"
            description="Daftarkan worker agent agar task dapat didistribusikan."
            action={
              <Button
                onClick={() => {
                  setEditing(null);
                  setFormOpen(true);
                }}
              >
                Daftarkan Agent
              </Button>
            }
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Kode</th>
                    <th scope="col">Nama</th>
                    <th scope="col">Provider</th>
                    <th scope="col">Status</th>
                    <th scope="col">Beban</th>
                    <th scope="col">Endpoint</th>
                    <th scope="col">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((agent) => (
                    <tr key={agent.id}>
                      <td className="font-mono text-xs font-semibold">{agent.code}</td>
                      <td>{agent.name}</td>
                      <td>
                        {agent.providerName ?? '—'}
                        {agent.providerActive === false ? <span className="ml-1 text-xs text-muted">(Nonaktif)</span> : null}
                      </td>
                      <td>
                        <Badge tone={statusTone(agent.isActive ? agent.status : 'INACTIVE')}>
                          {agent.isActive ? agent.status : 'NONAKTIF'}
                        </Badge>
                        {agent.lastError ? (
                          <p className="mt-1 max-w-[220px] text-xs text-danger" title={agent.lastError}>
                            {agent.lastError}
                          </p>
                        ) : null}
                      </td>
                      <td className="font-mono text-xs">
                        {agent.activeTasksCount} / {agent.maxConcurrency}
                      </td>
                      <td className="max-w-[220px] break-all font-mono text-xs">{agent.endpointUrl}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditing(agent);
                              setFormOpen(true);
                            }}
                          >
                            Ubah
                          </Button>
                          {agent.isActive ? (
                            <Button variant="ghost" onClick={() => setDeactivating(agent)}>
                              Nonaktifkan
                            </Button>
                          ) : null}
                        </div>
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
        <AgentForm
          agent={editing}
          providers={providers}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={(created) => {
            void load();
            if (created) setNewToken({ token: created.token, code: created.code });
          }}
        />
      ) : null}

      {newToken ? (
        <TokenModal token={newToken.token} agentCode={newToken.code} onClose={() => setNewToken(null)} />
      ) : null}

      <ConfirmDialog
        open={deactivating !== null}
        title="Nonaktifkan Agent"
        message={
          <>
            Agent <strong className="font-mono">{deactivating?.code}</strong> akan dinonaktifkan. Agent tidak dapat
            dinonaktifkan selama masih memiliki task aktif.
          </>
        }
        confirmLabel="Nonaktifkan"
        pending={pendingDeactivate}
        onConfirm={() => void deactivate()}
        onClose={() => setDeactivating(null)}
      />
    </div>
  );
}
