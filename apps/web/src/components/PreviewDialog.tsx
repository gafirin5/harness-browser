import { useEffect, useRef, useState } from 'react';
import type { Worktree } from '@dorado/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';
import { Field, Modal, useToast } from './ui';

interface DomPick {
  tagName: string;
  selector: string;
  html: string;
  styles: Record<string, unknown>;
}

function formatPick(pick: DomPick): string {
  return `[UI Element] selector="${pick.selector}" tag=${pick.tagName} styles=${JSON.stringify(
    pick.styles
  )} html="${(pick.html || '').slice(0, 200)}"`;
}

export function PreviewDialog({
  worktrees,
  selectedWorktreeId,
  activeTerminalId,
  onClose
}: {
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  activeTerminalId: string | null;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [worktreeId, setWorktreeId] = useState(selectedWorktreeId ?? worktrees[0]?.id ?? '');
  const [port, setPort] = useState('');
  const [ports, setPorts] = useState<number[]>([]);
  const [src, setSrc] = useState('');
  const [inspect, setInspect] = useState(false);
  const [pick, setPick] = useState<DomPick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string } | null;
      if (data && data.type === 'DORADO_DOM_PICK') {
        setPick(data as unknown as DomPick);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const sendInspect = (on: boolean): void => {
    iframeRef.current?.contentWindow?.postMessage({ type: on ? 'DORADO_INSPECT_ON' : 'DORADO_INSPECT_OFF' }, '*');
  };

  const detect = async (): Promise<void> => {
    setError(null);
    try {
      const response = await apiGet<{ data: { ports: number[] } }>(`/worktrees/${worktreeId}/ports`);
      setPorts(response.data.ports);
      if (response.data.ports[0] && !port) setPort(String(response.data.ports[0]));
      if (response.data.ports.length === 0) setError('Tidak ada port terdeteksi; masukkan port manual.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mendeteksi port.');
    }
  };

  const load = (): void => {
    const value = Number(port);
    if (!Number.isInteger(value) || value < 1024 || value > 65535) {
      setError('Port harus berupa angka 1024–65535.');
      return;
    }
    setError(null);
    setSrc(`/api/preview/${worktreeId}/${value}/?inspect=1&t=${Date.now()}`);
  };

  const toggleInspect = (): void => {
    const next = !inspect;
    setInspect(next);
    sendInspect(next);
  };

  const sendToTerminal = async (): Promise<void> => {
    if (!pick) return;
    if (!activeTerminalId) {
      setError('Tidak ada terminal aktif.');
      return;
    }
    try {
      await apiPost(`/terminals/${activeTerminalId}/input`, { data: `${formatPick(pick)} ` });
      push('success', 'Konteks elemen dikirim ke terminal.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengirim ke terminal.');
    }
  };

  return (
    <Modal
      title="Live Preview & Design Mode"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="row" style={{ gap: 8 }}>
        <Field label="Worktree">
          <select className="select" value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Port">
          <input
            className="input"
            value={port}
            onChange={(event) => setPort(event.target.value.replace(/[^0-9]/g, ''))}
            placeholder="3000"
            list="preview-ports"
          />
          <datalist id="preview-ports">
            {ports.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </Field>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end', paddingBottom: 6 }}>
          <button className="btn tiny" onClick={() => void detect()}>
            Deteksi
          </button>
          <button className="btn tiny primary" onClick={load}>
            Muat
          </button>
          <button className={`btn tiny ${inspect ? 'primary' : ''}`} onClick={toggleInspect} disabled={!src}>
            {inspect ? 'Pilih Elemen: ON' : 'Pilih Elemen'}
          </button>
        </div>
      </div>

      {pick ? (
        <div className="preview-pick">
          <code className="quick-command-code">{formatPick(pick)}</code>
          <button className="btn tiny primary" onClick={() => void sendToTerminal()} disabled={!activeTerminalId}>
            Kirim ke Terminal
          </button>
        </div>
      ) : null}

      {src ? (
        <iframe
          ref={iframeRef}
          className="preview-frame"
          title="Live preview"
          src={src}
          onLoad={() => sendInspect(inspect)}
        />
      ) : (
        <div className="empty">Masukkan port lalu klik Muat untuk pratinjau aplikasi worktree.</div>
      )}
    </Modal>
  );
}
