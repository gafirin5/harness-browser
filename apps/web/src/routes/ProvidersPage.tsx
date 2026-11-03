import { useCallback, useEffect, useState } from 'react';
import type { Provider, ProviderType } from '@orca/shared';
import { PROVIDER_TYPES } from '@orca/shared';
import { ApiError, apiGet, apiPatch, apiPost } from '../lib/api';
import { formatUsd } from '../lib/format';
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
  Select,
  Spinner,
  statusTone
} from '../components/ui';

interface ListResponse {
  data: Provider[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

const emptyForm = {
  name: '',
  provider_type: 'LITELLM' as ProviderType,
  base_url: '',
  api_key: '',
  default_model: '',
  cost_per_1k_tokens: '0.0020'
};

function ProviderForm({
  provider,
  onClose,
  onSaved
}: {
  provider: Provider | null;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [form, setForm] = useState(() =>
    provider
      ? {
          name: provider.name,
          provider_type: provider.providerType,
          base_url: provider.baseUrl,
          api_key: '',
          default_model: provider.defaultModel,
          cost_per_1k_tokens: provider.costPer1kTokens
        }
      : emptyForm
  );
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
      if (provider) {
        await apiPatch(`/providers/${provider.id}`, {
          name: form.name,
          provider_type: form.provider_type,
          base_url: form.base_url,
          default_model: form.default_model,
          cost_per_1k_tokens: form.cost_per_1k_tokens,
          ...(form.api_key ? { api_key: form.api_key } : {})
        });
        push('success', 'Provider berhasil diperbarui.');
      } else {
        await apiPost('/providers', form);
        push('success', 'Provider berhasil disimpan.');
      }
      onSaved();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        if (caught.status === 409 && caught.message.includes('Nama provider')) {
          setFields({ name: caught.message });
        } else {
          setFields(caught.fields ?? {});
        }
      } else {
        setError('Gagal menyimpan provider.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      title={provider ? 'Ubah Provider' : 'Tambah Provider'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Batal
          </Button>
          <Button type="submit" form="provider-form" loading={pending}>
            Simpan Provider
          </Button>
        </>
      }
    >
      <form id="provider-form" onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {error ? (
          <div role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </div>
        ) : null}
        <Input
          label="Nama Provider"
          name="provider-name"
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
          error={fields.name}
          maxLength={100}
          required
        />
        <Select
          label="Tipe Provider"
          name="provider-type"
          value={form.provider_type}
          onChange={(event) => set('provider_type', event.target.value)}
        >
          {PROVIDER_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </Select>
        <Input
          label="Base URL"
          name="provider-base-url"
          value={form.base_url}
          onChange={(event) => set('base_url', event.target.value)}
          error={fields.base_url}
          placeholder="https://llm.internal/v1"
          maxLength={255}
          required
        />
        <Input
          label={provider ? 'API Key (kosongkan bila tidak diubah)' : 'API Key'}
          name="provider-api-key"
          type="password"
          value={form.api_key}
          onChange={(event) => set('api_key', event.target.value)}
          error={fields.api_key}
          autoComplete="new-password"
          required={!provider}
        />
        <Input
          label="Model Default"
          name="provider-model"
          value={form.default_model}
          onChange={(event) => set('default_model', event.target.value)}
          error={fields.default_model}
          placeholder="gpt-4o-mini"
          maxLength={100}
          required
        />
        <Input
          label="Tarif per 1K Token (USD)"
          name="provider-cost"
          value={form.cost_per_1k_tokens}
          onChange={(event) => set('cost_per_1k_tokens', event.target.value)}
          error={fields.cost_per_1k_tokens}
          inputMode="decimal"
          placeholder="0.0020"
          hint="Maksimal 4 angka desimal, contoh 0.0020."
          required
        />
      </form>
    </Modal>
  );
}

export function ProvidersPage(): JSX.Element {
  const { push } = useToast();
  const [items, setItems] = useState<Provider[]>([]);
  const [meta, setMeta] = useState({ page: 1, totalPages: 1, total: 0, pageSize: 20 });
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [deactivating, setDeactivating] = useState<Provider | null>(null);
  const [pendingDeactivate, setPendingDeactivate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query) params.set('q', query);
      params.set('page', String(page));
      const response = await apiGet<ListResponse>(`/providers?${params.toString()}`);
      setItems(response.data);
      setMeta(response.meta);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const deactivate = async (): Promise<void> => {
    if (!deactivating) return;
    setPendingDeactivate(true);
    try {
      await apiPatch(`/providers/${deactivating.id}`, { is_active: false });
      push('success', 'Provider berhasil dinonaktifkan.');
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
        title="Manajemen Provider LLM"
        description="Simpan endpoint, model default, dan tarif token untuk perutean permintaan AI."
        actions={<Button onClick={() => setFormOpen(true)}>Tambah Provider</Button>}
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
            <label htmlFor="provider-search" className="field-label">
              Cari provider
            </label>
            <input
              id="provider-search"
              className="input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nama provider..."
            />
          </div>
          <Button type="submit">Cari</Button>
          {query ? (
            <Button
              type="button"
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
            <Spinner label="Memuat provider..." />
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada provider"
            description="Tambahkan provider LLM pertama beserta tarif tokennya."
            action={<Button onClick={() => setFormOpen(true)}>Tambah Provider</Button>}
          />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Nama</th>
                    <th scope="col">Tipe</th>
                    <th scope="col">Model</th>
                    <th scope="col">Tarif / 1K</th>
                    <th scope="col">API Key</th>
                    <th scope="col">Status</th>
                    <th scope="col">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((provider) => (
                    <tr key={provider.id}>
                      <td className="font-semibold">{provider.name}</td>
                      <td>{provider.providerType}</td>
                      <td className="font-mono text-xs">{provider.defaultModel}</td>
                      <td className="font-mono text-xs">{formatUsd(provider.costPer1kTokens)}</td>
                      <td className="font-mono text-xs">••••{provider.apiKeyLast4 ?? '????'}</td>
                      <td>
                        <Badge tone={statusTone(provider.isActive ? 'ACTIVE' : 'INACTIVE')}>
                          {provider.isActive ? 'Aktif' : 'Nonaktif'}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditing(provider);
                              setFormOpen(true);
                            }}
                          >
                            Ubah
                          </Button>
                          {provider.isActive ? (
                            <Button variant="ghost" onClick={() => setDeactivating(provider)}>
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
        <ProviderForm
          provider={editing}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSaved={() => void load()}
        />
      ) : null}

      <ConfirmDialog
        open={deactivating !== null}
        title="Nonaktifkan Provider"
        message={
          <>
            Provider <strong>{deactivating?.name}</strong> akan dinonaktifkan. Riwayat task tetap tersimpan, tetapi
            provider tidak dapat dipilih untuk task baru.
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
