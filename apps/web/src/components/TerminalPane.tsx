import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { terminalWsUrl } from '../lib/api';

export function TerminalPane({ terminalId }: { terminalId: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);

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
      terminal.dispose();
    };
  }, [terminalId]);

  return <div className="terminal-host" ref={hostRef} />;
}