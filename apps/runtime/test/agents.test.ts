import { describe, expect, it } from 'vitest';
import { sessionCreateSchema } from '@dorado/shared';
import { buildAgentArgs } from '../src/modules/sessions/agents.js';

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
