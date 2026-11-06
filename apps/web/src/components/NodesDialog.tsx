import { useEffect, useState } from 'react';
import type { RemoteNodeCreated, RemoteNodeInfo, UserInfo } from '@dorado/shared';
import { ApiError, apiDelete, apiGet, apiPost, copyText } from '../lib/api';
import { Modal, useToast } from './ui';

export function NodesDialog({
  currentUser,
  activeNodeId,
  onSelectNode,
  onClose
}: {
  currentUser: UserInfo;
  activeNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [nodes, setNodes] = useState<RemoteNodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RemoteNodeCreated | null>(null);
  const isAdmin = currentUser.role === 'ADMIN';

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<{ data: RemoteNodeInfo[] }>('/nodes');
      setNodes(response.data);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat daftar node.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleCreate = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!name.trim()) return;
    setPending(true);
    setError(null);
    try {
      const response = await apiPost<{ data: RemoteNodeCreated }>('/nodes', { name: name.trim() });
      setCreated(response.data);
      setName('');
      push('success', `Node "${response.data.name}" didaftarkan.`);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mendaftarkan node.');
    } finally {
      setPending(false);
    }
  };

  const handleDelete = async (node: RemoteNodeInfo): Promise<void> => {
    if (!window.confirm(`Hapus node "${node.name}"? Koneksi dari node ini akan diputus.`)) return;
    try {
      await apiDelete(`/nodes/${node.id}`);
      if (activeNodeId === node.id) {
        onSelectNode(null);
      }
      push('success', `Node "${node.name}" dihapus.`);
      await load();
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal menghapus node.');
    }
  };

  const handleRotate = async (node: RemoteNodeInfo): Promise<void> => {
    if (!window.confirm(`Rotasi token node "${node.name}"? Token lama akan langsung tidak berlaku.`)) return;
    try {
      const response = await apiPost<{ data: { token: string; pairCommand: string } }>(`/nodes/${node.id}/token`);
      setCreated({
        ...node,
        token: response.data.token,
        pairCommand: response.data.pairCommand
      });
      push('success', `Token node "${node.name}" diperbarui.`);
      await load();
    } catch (caught) {
      push('error', caught instanceof ApiError ? caught.message : 'Gagal merotasi token node.');
    }
  };

  const handleCopy = async (text: string, label: string): Promise<void> => {
    const ok = await copyText(text);
    push(ok ? 'success' : 'error', ok ? `${label} disalin.` : `Gagal menyalin ${label.toLowerCase()}.`);
  };

  return (
    <Modal
      title="Dorado Remote Nodes (Federation)"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <p className="muted" style={{ marginTop: 0, fontSize: 11.5 }}>
        Kendalikan mesin lain dari Controller ini melalui koneksi reverse WebSocket aman (tembus NAT/Firewall).
      </p>

      {error ? <div className="error-banner">{error}</div> : null}

      {created ? (
        <div className="node-created-banner">
          <div className="node-created-head">
            <strong>Token Node Baru: {created.name}</strong>
            <button className="btn tiny ghost" onClick={() => setCreated(null)}>
              Tutup
            </button>
          </div>
          <p className="hint">Jalankan perintah berikut di mesin remote yang ingin dijadikan Dorado Node:</p>
          <pre className="code-block mono">{created.pairCommand}</pre>
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button
              className="btn tiny primary"
              onClick={() => void handleCopy(created.pairCommand, 'Perintah Pairing')}
            >
              Salin Perintah
            </button>
            <button className="btn tiny" onClick={() => void handleCopy(created.token, 'Token Node')}>
              Salin Token Saja
            </button>
          </div>
        </div>
      ) : null}

      {isAdmin ? (
        <form className="node-create-form" onSubmit={(e) => void handleCreate(e)}>
          <input
            className="input"
            placeholder="Nama node (misal: Server GPU-1, VPS Dev, MacBook)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
            maxLength={80}
            required
            aria-label="Nama node baru"
          />
          <button className="btn primary" type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Mendaftarkan...' : '+ Tambah Node'}
          </button>
        </form>
      ) : null}

      <div className="node-list">
        <div
          className={`node-card ${activeNodeId === null ? 'active' : ''}`}
          onClick={() => onSelectNode(null)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelectNode(null);
          }}
        >
          <div className="node-card-main">
            <div className="node-card-title">
              <span className="mono">🖥️ Local (Controller Host)</span>
              <span className="badge running">online</span>
            </div>
            <div className="node-card-meta">Worktree, terminal, dan agent berjalan langsung di host ini.</div>
          </div>
          <div className="node-card-actions">
            {activeNodeId === null ? (
              <span className="badge active">Aktif</span>
            ) : (
              <button
                className="btn tiny"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectNode(null);
                }}
              >
                Gunakan
              </button>
            )}
          </div>
        </div>

        {loading ? <div className="empty">Memuat daftar node...</div> : null}
        {!loading && nodes.length === 0 ? (
          <div className="empty">Belum ada node remote terdaftar. Daftarkan mesin baru di atas.</div>
        ) : null}

        {nodes.map((node) => {
          const isOnline = node.status === 'online';
          const isSelected = activeNodeId === node.id;
          return (
            <div
              key={node.id}
              className={`node-card ${isSelected ? 'active' : ''}`}
              onClick={() => onSelectNode(node.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelectNode(node.id);
              }}
            >
              <div className="node-card-main">
                <div className="node-card-title">
                  <span>🌐 {node.name}</span>
                  <span className={`badge ${isOnline ? 'running' : 'offline'}`}>{node.status}</span>
                  {isOnline && node.latencyMs !== null ? (
                    <span className="node-latency mono">{node.latencyMs} ms</span>
                  ) : null}
                </div>
                <div className="node-card-meta">
                  {node.hostname ? <span className="mono">{node.hostname}</span> : <span>Hostname —</span>}
                  {node.platform ? <span> · {node.platform}</span> : null}
                  {node.agents.length > 0 ? (
                    <span>
                      {' '}
                      · {node.agents.length} agent ({node.agents.map((a) => a.name).join(', ')})
                    </span>
                  ) : (
                    <span> · 0 agent</span>
                  )}
                </div>
              </div>
              <div className="node-card-actions" onClick={(e) => e.stopPropagation()}>
                {isSelected ? (
                  <span className="badge active">Aktif</span>
                ) : (
                  <button className="btn tiny" onClick={() => onSelectNode(node.id)}>
                    Gunakan
                  </button>
                )}
                {isAdmin ? (
                  <>
                    <button
                      className="btn tiny"
                      onClick={() => void handleRotate(node)}
                      title="Generate token baru untuk node ini"
                    >
                      Token Baru
                    </button>
                    <button
                      className="btn tiny ghost danger"
                      onClick={() => void handleDelete(node)}
                      title="Hapus node"
                    >
                      Hapus
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default NodesDialog;
