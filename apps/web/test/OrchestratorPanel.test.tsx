import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OrchestratorPanel from '../src/components/OrchestratorPanel';
import { ToastProvider } from '../src/components/ui';
import { apiGet } from '../src/lib/api';

vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/api')>();
  return {
    ...actual,
    apiGet: vi.fn()
  };
});

const mockedApiGet = vi.mocked(apiGet);

class MockEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener = vi.fn();
  close = vi.fn();
}

const summary = {
  agentsActive: 3,
  tasksRunning: 2,
  tasksFailedToday: 1,
  costTodayUsd: '0.0050',
  alerts: [{ type: 'AGENT_OFFLINE' as const, id: 1, label: 'AGT-1', since: '2026-11-04T00:00:00.000Z' }],
  recentLogs: [
    {
      id: 1,
      taskId: 1,
      taskCode: 'TSK-20261104-0001',
      logLevel: 'INFO' as const,
      message: 'Task dibuat.',
      createdAt: '2026-11-04T00:00:00.000Z'
    }
  ]
};

describe('OrchestratorPanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mockedApiGet.mockReset();
  });

  it('menampilkan ringkasan dashboard dan daftar provider', async () => {
    vi.stubGlobal('EventSource', MockEventSource);
    mockedApiGet.mockImplementation(async (path: string) => {
      if (path === '/orchestrator/summary') return { data: summary } as never;
      if (path.startsWith('/orchestrator/providers')) {
        return {
          data: [
            {
              id: 1,
              name: 'Perf Provider',
              providerType: 'LITELLM',
              baseUrl: 'http://127.0.0.1:9999/v1',
              defaultModel: 'gpt-4o-mini',
              costPer1kTokens: '0.0020',
              isActive: true,
              hasApiKey: true,
              apiKeyLast4: '5678',
              createdAt: '2026-11-04T00:00:00.000Z',
              updatedAt: '2026-11-04T00:00:00.000Z'
            }
          ]
        } as never;
      }
      throw new Error(`Unexpected path: ${path}`);
    });

    const user = userEvent.setup();
    render(
      <ToastProvider>
        <OrchestratorPanel onClose={() => undefined} />
      </ToastProvider>
    );

    expect(await screen.findByText('Agent Aktif')).toBeInTheDocument();
    expect(screen.getByText('Agent Aktif').parentElement).toHaveTextContent('3');
    expect(screen.getByText('Biaya Hari Ini').parentElement).toHaveTextContent('$0.0050');
    expect(screen.getByText('AGT-1')).toBeInTheDocument();
    expect(screen.getByText('TSK-20261104-0001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Provider' }));
    expect(await screen.findByText('Perf Provider')).toBeInTheDocument();
    expect(screen.getByText('••••5678')).toBeInTheDocument();
  });
});
