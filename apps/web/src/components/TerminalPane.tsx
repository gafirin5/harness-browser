import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { copyText, terminalWsUrl, uploadAttachment } from '../lib/api';
import { FONT_FAMILIES, TERMINAL_THEMES, matchesCombo, type TerminalPrefs } from '../lib/terminal-prefs';

export function TerminalPane({
  terminalId,
  worktreeId,
  active = true,
  searchNonce = 0,
  resetNonce = 0,
  prefs
}: {
  terminalId: string;
  worktreeId: string;
  active?: boolean;
  searchNonce?: number;
  resetNonce?: number;
  prefs: TerminalPrefs;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sendRef = useRef<((message: unknown) => void) | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listening, setListening] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;

    const terminal = new Terminal({
      fontFamily: FONT_FAMILIES[prefs.fontFamily],
      fontSize: prefs.fontSize,
      lineHeight: 1.25,
      cursorBlink: prefs.cursorBlink,
      scrollback: 8000,
      allowTransparency: true,
      theme: TERMINAL_THEMES[prefs.theme]
    });
    terminalRef.current = terminal;
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    fitRef.current = fit;
    const search = new SearchAddon();
    terminal.loadAddon(search);
    searchRef.current = search;
    terminal.open(host);
    fit.fit();
    terminal.focus();

    let disposed = false;
    const core = (
      terminal as unknown as {
        _core?: { viewport?: { syncScrollArea: (force?: boolean) => void }; _renderService?: unknown };
      }
    )._core;
    if (core?.viewport) {
      const origSync = core.viewport.syncScrollArea.bind(core.viewport);
      core.viewport.syncScrollArea = function (force?: boolean): void {
        if (disposed || !core._renderService) return;
        try {
          origSync(force);
        } catch {
          // abaikan saat transisi layout atau dispose
        }
      };
    }

    const linkDisposable = terminal.registerLinkProvider({
      provideLinks: (lineNumber, callback) => {
        const bufferLine = terminal.buffer.active.getLine(lineNumber - 1);
        if (!bufferLine) {
          callback(undefined);
          return;
        }
        const text = bufferLine.translateToString(true);
        const links: Array<{
          range: { start: { x: number; y: number }; end: { x: number; y: number } };
          text: string;
          activate: () => void;
        }> = [];
        const regex = /https?:\/\/[^\s)]+/g;
        let match = regex.exec(text);
        while (match) {
          const url = match[0];
          const start = match.index + 1;
          links.push({
            range: { start: { x: start, y: lineNumber }, end: { x: start + url.length - 1, y: lineNumber } },
            text: url,
            activate: () => {
              window.open(url, '_blank', 'noopener,noreferrer');
            }
          });
          match = regex.exec(text);
        }
        callback(links.length > 0 ? links : undefined);
      }
    });

    const onContextMenu = (event: MouseEvent): void => {
      const selection = terminal.getSelection();
      if (!selection) return;
      event.preventDefault();
      void copyText(selection);
    };
    host.addEventListener('contextmenu', onContextMenu);

    let socket: WebSocket | null = null;
    let retries = 0;
    let resizeTimer = 0;

    const send = (message: unknown): void => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    sendRef.current = send;

    const connect = (): void => {
      if (disposed) return;
      socket = new WebSocket(terminalWsUrl(terminalId));

      socket.onopen = () => {
        if (disposed) return;
        retries = 0;
        send({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      };

      socket.onmessage = (event) => {
        if (disposed) return;
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
      if (disposed) return;
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (disposed) return;
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
      linkDisposable.dispose();
      host.removeEventListener('contextmenu', onContextMenu);
      socket?.close();
      searchRef.current = null;
      fitRef.current = null;
      terminalRef.current = null;
      sendRef.current = null;
      if (core?.viewport) {
        core.viewport.syncScrollArea = () => undefined;
      }
      try {
        terminal.dispose();
      } catch {
        // abaikan saat transisi unmount
      }
    };
  }, [terminalId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!active) return;
      if (matchesCombo(event, prefs.searchKey)) {
        event.preventDefault();
        setSearchOpen(true);
      } else if (matchesCombo(event, prefs.copyKey)) {
        const selection = terminalRef.current?.getSelection();
        if (selection) {
          event.preventDefault();
          void copyText(selection);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, prefs.searchKey, prefs.copyKey]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return undefined;
    terminal.options.fontSize = prefs.fontSize;
    terminal.options.fontFamily = FONT_FAMILIES[prefs.fontFamily];
    terminal.options.cursorBlink = prefs.cursorBlink;
    terminal.options.theme = TERMINAL_THEMES[prefs.theme];
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit();
      } catch {
        // abaikan saat layout transisi
      }
    }, 20);
    return () => window.clearTimeout(timer);
  }, [prefs.fontSize, prefs.fontFamily, prefs.cursorBlink, prefs.theme]);

  useEffect(() => {
    if (resetNonce > 0) {
      terminalRef.current?.reset();
      terminalRef.current?.focus();
    }
  }, [resetNonce]);

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

  const uploadFiles = useCallback(
    async (files: FileList | null): Promise<void> => {
      if (!files || files.length === 0) return;
      for (const file of Array.from(files).slice(0, 5)) {
        if (file.size > 5 * 1024 * 1024) {
          terminalRef.current?.write(`\r\n\x1b[31m[file ${file.name} melebihi 5 MB, dilewati]\x1b[0m\r\n`);
          continue;
        }
        try {
          const result = await uploadAttachment(worktreeId, file);
          sendRef.current?.({ type: 'input', data: `@${result.path} ` });
        } catch (error) {
          terminalRef.current?.write(`\r\n\x1b[31m[upload gagal: ${(error as Error).message}]\x1b[0m\r\n`);
        }
      }
    },
    [worktreeId]
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const onPaste = (event: ClipboardEvent): void => {
      if (event.clipboardData?.files?.length) {
        event.preventDefault();
        void uploadFiles(event.clipboardData.files);
      }
    };
    const onDrop = (event: DragEvent): void => {
      if (event.dataTransfer?.files?.length) {
        event.preventDefault();
        void uploadFiles(event.dataTransfer.files);
      }
    };
    const onDragover = (event: DragEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('paste', onPaste);
    host.addEventListener('drop', onDrop);
    host.addEventListener('dragover', onDragover);
    return () => {
      window.removeEventListener('paste', onPaste);
      host.removeEventListener('drop', onDrop);
      host.removeEventListener('dragover', onDragover);
    };
  }, [uploadFiles]);

  const find = (direction: 'next' | 'previous', incremental = false): void => {
    if (!query) {
      searchRef.current?.clearDecorations();
      return;
    }
    const options = { caseSensitive: false, incremental, regex: false };
    if (direction === 'previous') searchRef.current?.findPrevious(query, options);
    else searchRef.current?.findNext(query, options);
  };

  const speechCtor =
    typeof window !== 'undefined'
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
      : undefined;

  const toggleVoice = (): void => {
    if (!speechCtor) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (speechCtor as new () => any)();
    recognition.lang = 'id-ID';
    recognition.continuous = true;
    recognition.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any): void => {
      let text = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal) text += result[0].transcript;
      }
      if (text && sendRef.current) sendRef.current({ type: 'input', data: text });
    };
    recognition.onend = (): void => setListening(false);
    recognition.onerror = (): void => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  return (
    <>
      <div className="terminal-host" ref={hostRef} />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.json,.pdf"
        style={{ display: 'none' }}
        onChange={(event) => {
          void uploadFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <button
        className="terminal-attach btn tiny"
        onClick={() => fileInputRef.current?.click()}
        title="Lampirkan file/gambar (atau tempel/drop)"
        aria-label="Lampirkan file"
      >
        📎
      </button>
      {speechCtor ? (
        <button
          className={`terminal-mic btn tiny ${listening ? 'active' : ''}`}
          onClick={toggleVoice}
          title={listening ? 'Hentikan dikte' : 'Dikte suara ke terminal'}
          aria-label="Dikte suara"
        >
          {listening ? '⏹' : '🎤'}
        </button>
      ) : null}
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
