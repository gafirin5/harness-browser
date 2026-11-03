import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { terminalWsUrl } from '../lib/api';

export function TerminalPane({
  terminalId,
  active = true,
  searchNonce = 0
}: {
  terminalId: string;
  active?: boolean;
  searchNonce?: number;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace",
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 8000,
      allowTransparency: true,
      theme: {
        background: '#060a0f',
        foreground: '#dce8f5',
        cursor: '#f0b45c',
        cursorAccent: '#060a0f',
        selectionBackground: 'rgba(240, 180, 92, 0.25)',
        black: '#1a2430',
        red: '#ef7272',
        green: '#5fd18a',
        yellow: '#f0b45c',
        blue: '#6aa8ff',
        magenta: '#c792ea',
        cyan: '#59c7ba',
        white: '#dce8f5',
        brightBlack: '#5d7186',
        brightRed: '#ff9a9a',
        brightGreen: '#86e6aa',
        brightYellow: '#ffd08a',
        brightBlue: '#9cc4ff',
        brightMagenta: '#ddb4f2',
        brightCyan: '#8de3d8',
        brightWhite: '#ffffff'
      }
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    const search = new SearchAddon();
    terminal.loadAddon(search);
    searchRef.current = search;
    terminal.open(host);
    fit.fit();
    terminal.focus();

    let disposed = false;
    let socket: WebSocket | null = null;
    let retries = 0;
    let resizeTimer = 0;

    const send = (message: unknown): void => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };

    const connect = (): void => {
      if (disposed) return;
      socket = new WebSocket(terminalWsUrl(terminalId));

      socket.onopen = () => {
        retries = 0;
        send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      };

      socket.onmessage = (event) => {
        let message: { type?: string; data?: string; code?: number; message?: string };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          return;
        }
        if ((message.type === 'replay' || message.type === 'output') && typeof message.data === 'string') {
          terminal.write(message.data);
        } else if (message.type === 'exit') {
          terminal.write(`\r\n\x1b[33m[process exited with code ${message.code ?? 0}]\x1b[0m\r\n`);
        } else if (message.type === 'error' && message.message) {
          terminal.write(`\r\n\x1b[31m${message.message}\x1b[0m\r\n`);
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        retries += 1;
        if (retries <= 3) {
          window.setTimeout(connect, 800 * retries);
        } else {
          terminal.write('\r\n\x1b[31m[terputus dari runtime]\x1b[0m\r\n');
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    const inputDisposable = terminal.onData((data) => send({ type: 'input', data }));
    const resizeDisposable = terminal.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }));

    const observer = new ResizeObserver(() => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        try {
          fit.fit();
          send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
        } catch {
          // abaikan saat layout transisi
        }
      }, 40);
    });
    observer.observe(host);

    connect();

    return () => {
      disposed = true;
      observer.disconnect();
      if (resizeTimer) window.clearTimeout(resizeTimer);
      inputDisposable.dispose();
      resizeDisposable.dispose();
      socket?.close();
      searchRef.current = null;
      terminal.dispose();
    };
  }, [terminalId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!active) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      setSearchOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  useEffect(() => {
    if (searchOpen) {
      const timer = window.setTimeout(() => searchInputRef.current?.focus(), 20);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [searchOpen]);

  useEffect(() => {
    if (active && searchNonce > 0) setSearchOpen(true);
  }, [active, searchNonce]);

  const find = (direction: 'next' | 'previous', incremental = false): void => {
    if (!query) {
      searchRef.current?.clearDecorations();
      return;
    }
    const options = { caseSensitive: false, incremental, regex: false };
    if (direction === 'previous') searchRef.current?.findPrevious(query, options);
    else searchRef.current?.findNext(query, options);
  };

  return (
    <>
      <div className="terminal-host" ref={hostRef} />
      {searchOpen ? (
        <div className="terminal-search">
          <input
            ref={searchInputRef}
            className="input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              window.setTimeout(() => find('next', true), 0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                find(event.shiftKey ? 'previous' : 'next');
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setSearchOpen(false);
                searchRef.current?.clearDecorations();
              }
            }}
            placeholder="Cari di terminal..."
            aria-label="Cari di terminal"
          />
          <button className="btn tiny" onClick={() => find('previous')} title="Sebelumnya">
            ↑
          </button>
          <button className="btn tiny" onClick={() => find('next')} title="Berikutnya">
            ↓
          </button>
          <button
            className="btn tiny ghost"
            onClick={() => {
              setSearchOpen(false);
              searchRef.current?.clearDecorations();
            }}
            title="Tutup pencarian"
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}