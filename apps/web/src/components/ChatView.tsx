import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatBlock } from '@dorado/shared';
import { ApiError, apiGet, apiPost } from '../lib/api';

export function ChatView({ terminalId }: { terminalId: string }): JSX.Element {
  const [blocks, setBlocks] = useState<ChatBlock[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const response = await apiGet<{ data: ChatBlock[] }>(`/terminals/${terminalId}/chat-blocks`);
      setBlocks(response.data);
    } catch {
      // abaikan polling error
    }
  }, [terminalId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const element = listRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [blocks]);

  const send = async (data: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/terminals/${terminalId}/input`, { data });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengirim ke terminal.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!input.trim()) return;
    await send(`${input}\r`);
    setInput('');
  };

  const waiting = blocks.length > 0 && blocks[blocks.length - 1]?.type === 'prompt_wait';

  return (
    <div className="chat-view">
      <div className="chat-blocks" ref={listRef}>
        {blocks.length === 0 ? <div className="empty">Belum ada output sesi.</div> : null}
        {blocks.map((block) => (
          <div key={block.id} className={`chat-block ${block.type}`}>
            <pre>{block.content}</pre>
          </div>
        ))}
      </div>
      {waiting ? (
        <div className="chat-approve">
          <span className="muted" style={{ fontSize: 10.5 }}>
            Menunggu persetujuan:
          </span>
          <button className="btn tiny primary" disabled={busy} onClick={() => void send('y\r')}>
            Yes (y)
          </button>
          <button className="btn tiny" disabled={busy} onClick={() => void send('n\r')}>
            No (n)
          </button>
          <button className="btn tiny" disabled={busy} onClick={() => void send('\r')}>
            Enter
          </button>
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}
      <form className="chat-composer" onSubmit={(event) => void submit(event)}>
        <input
          className="input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ketik instruksi / balasan..."
          aria-label="Balasan chat"
        />
        <button className="btn tiny primary" type="submit" disabled={busy || !input.trim()}>
          Kirim ↵
        </button>
      </form>
    </div>
  );
}
