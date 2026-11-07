import { describe, expect, it } from 'vitest';
import { sessionCreateSchema } from '@dorado/shared';
import { agentCommandArgs, buildAgentArgs, listAgents } from '../src/modules/sessions/agents.js';
import { AGENT_PRESETS } from '../src/modules/sessions/agent-presets.js';

const opencodeArgs = ['run', '--prompt', '{{prompt}}', '--interactive'];

describe('buildAgentArgs', () => {
  it('mengganti placeholder saat prompt diisi', () => {
    expect(buildAgentArgs(opencodeArgs, 'perbaiki bug')).toEqual(['run', '--prompt', 'perbaiki bug', '--interactive']);
  });

  it('membuang pasangan --prompt saat prompt kosong agar agent interaktif', () => {
    expect(buildAgentArgs(opencodeArgs, '')).toEqual(['run', '--interactive']);
    expect(buildAgentArgs(opencodeArgs, '   ')).toEqual(['run', '--interactive']);
  });

  it('tetap mengembalikan args apa adanya bila tidak ada --prompt', () => {
    expect(buildAgentArgs(['run', '--interactive'], '')).toEqual(['run', '--interactive']);
  });
});

describe('agentCommandArgs', () => {
  const claude = {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['-c', '-p', '{{prompt}}'],
    interactiveArgs: [] as string[]
  };

  it('memakai interactiveArgs saat prompt kosong', () => {
    expect(agentCommandArgs(claude, '', 'run')).toEqual([]);
    expect(agentCommandArgs(claude, '   ', 'resume')).toEqual([]);
  });

  it('substitusi prompt pada mode run', () => {
    expect(agentCommandArgs(claude, 'perbaiki bug', 'run')).toEqual(['-p', 'perbaiki bug']);
  });

  it('memakai resumeArgs pada mode resume', () => {
    expect(agentCommandArgs(claude, 'lanjut', 'resume')).toEqual(['-c', '-p', 'lanjut']);
  });

  it('jatuh ke buildAgentArgs untuk agent tanpa interactiveArgs', () => {
    const legacy = { id: 'x', name: 'X', command: 'x', args: opencodeArgs };
    expect(agentCommandArgs(legacy, '')).toEqual(['run', '--interactive']);
  });
});

describe('agent presets', () => {
  it('memiliki id unik dan memuat agent umum', () => {
    const ids = AGENT_PRESETS.map((agent) => agent.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const expected of ['opencode', 'claude', 'codex', 'gemini', 'aider', 'cursor']) {
      expect(ids).toContain(expected);
    }
  });

  it('menandai preset bawaan pada listAgents', () => {
    const agents = listAgents();
    const opencode = agents.find((agent) => agent.id === 'opencode');
    expect(opencode?.source).toBe('builtin');
    expect(opencode?.builtin).toBe(true);
    expect(opencode?.resumeArgs).toEqual(['--continue', '--prompt', '{{prompt}}']);
  });
});

describe('sessionCreateSchema', () => {
  it('menerima sesi tanpa prompt', () => {
    const parsed = sessionCreateSchema.parse({
      worktreeId: 'wt-1',
      agent: 'opencode',
      title: 'Sesi interaktif'
    });
    expect(parsed.prompt).toBe('');
  });

  it('tetap menerima prompt yang diisi', () => {
    const parsed = sessionCreateSchema.parse({
      worktreeId: 'wt-1',
      agent: 'opencode',
      title: 'Sesi prompt',
      prompt: 'kerjakan task'
    });
    expect(parsed.prompt).toBe('kerjakan task');
  });
});
