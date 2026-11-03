import { useEffect, useRef, useState } from 'react';
import type { DashboardSummary } from '@orca/shared';
import { apiGet } from './api';

export type StreamMode = 'connecting' | 'streaming' | 'polling';

export function useSummaryStream(onSummary: (summary: DashboardSummary) => void): StreamMode {
  const [mode, setMode] = useState<StreamMode>('connecting');
  const callbackRef = useRef(onSummary);
  callbackRef.current = onSummary;

  useEffect(() => {
    let source: EventSource | null = null;
    let pollId: number | null = null;
    let watchdog: number | null = null;
    let failures = 0;
    let stopped = false;

    const poll = async (): Promise<void> => {
      try {
        const response = await apiGet<{ data: DashboardSummary }>('/dashboard/summary');
        if (!stopped) callbackRef.current(response.data);
      } catch {
        // biarkan polling mencoba lagi pada interval berikutnya
      }
    };

    const clearWatchdog = (): void => {
      if (watchdog !== null) {
        window.clearTimeout(watchdog);
        watchdog = null;
      }
    };

    const startPolling = (): void => {
      if (pollId !== null || stopped) return;
      clearWatchdog();
      setMode('polling');
      void poll();
      pollId = window.setInterval(() => void poll(), 2000);
    };

    /**
     * Cloudflare/proxy tertentu membuka koneksi SSE tetapi menahan body
     * (buffering). Bila tidak ada event dalam 6 detik, beralih ke polling.
     */
    const armWatchdog = (): void => {
      clearWatchdog();
      if (stopped) return;
      watchdog = window.setTimeout(() => {
        if (stopped) return;
        source?.close();
        source = null;
        startPolling();
      }, 6000);
    };

    const connect = (): void => {
      if (stopped) return;
      setMode('connecting');
      source = new EventSource('/api/events/stream', { withCredentials: true });
      armWatchdog();

      source.onopen = () => {
        failures = 0;
        setMode('streaming');
        armWatchdog();
      };

      source.addEventListener('summary', (event) => {
        failures = 0;
        setMode('streaming');
        armWatchdog();
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as DashboardSummary;
          callbackRef.current(data);
        } catch {
          // abaikan payload rusak
        }
      });

      source.onerror = () => {
        failures += 1;
        if (failures >= 2) {
          source?.close();
          source = null;
          startPolling();
        }
      };
    };

    connect();

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && pollId === null) void poll();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      source?.close();
      clearWatchdog();
      if (pollId !== null) window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return mode;
}
