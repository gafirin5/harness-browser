/**
 * Preset agent CLI yang didukung langsung oleh Dorado.
 *
 * Setiap entri berisi cara menjalankan agent pada tiga mode:
 * - `args`           — dijalankan non-interaktif dengan prompt (`{{prompt}}` disubstitusi).
 * - `resumeArgs`     — melanjutkan sesi terakhir di worktree yang sama.
 * - `interactiveArgs`— dibuka tanpa prompt (mode interaktif). Umumnya kosong.
 *
 * Catatan keamanan: flag auto-approve (mis. `--yes-always`, `--auto`,
 * `--dangerously-skip-permissions`, `--full-auto`) SENGAJA tidak dipasang default.
 * Tambahkan lewat `DORADO_AGENTS` atau dialog Kelola Agent bila memang diperlukan.
 *
 * Flag CLI dapat berubah antar versi tool; verifikasi dengan `<command> --help`.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
  resumeArgs?: string[];
  interactiveArgs?: string[];
  docsUrl?: string;
}

export const AGENT_PRESETS: AgentDefinition[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['--prompt', '{{prompt}}'],
    resumeArgs: ['--continue', '--prompt', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://opencode.ai/docs/'
  },
  {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['-c', '-p', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://docs.claude.com/en/docs/claude-code/cli-reference'
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    command: 'codex',
    args: ['exec', '{{prompt}}'],
    resumeArgs: ['exec', 'resume', '--last', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://developers.openai.com/codex/cli/'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['--resume', 'latest', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    command: 'qwen',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['--resume', 'latest', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://github.com/QwenLM/qwen-code'
  },
  {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    args: ['--message', '{{prompt}}'],
    resumeArgs: ['--restore-chat-history', '--message', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://aider.chat/docs/'
  },
  {
    id: 'cursor',
    name: 'Cursor Agent',
    command: 'cursor-agent',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['--resume', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://docs.cursor.com/en/cli/overview'
  },
  {
    id: 'crush',
    name: 'Crush',
    command: 'crush',
    args: ['run', '{{prompt}}'],
    resumeArgs: ['run', '--continue', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://github.com/charmbracelet/crush'
  },
  {
    id: 'droid',
    name: 'Factory Droid',
    command: 'droid',
    args: ['exec', '{{prompt}}'],
    resumeArgs: ['exec', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://docs.factory.ai/cli/droid-exec/overview'
  },
  {
    id: 'goose',
    name: 'Goose',
    command: 'goose',
    args: ['run', '-t', '{{prompt}}'],
    resumeArgs: ['run', '-r', '-t', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://block.github.io/goose/docs/getting-started/using/'
  },
  {
    id: 'amp',
    name: 'Amp',
    command: 'amp',
    args: ['-x', '{{prompt}}'],
    resumeArgs: ['-x', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://ampcode.com/manual'
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot CLI',
    command: 'copilot',
    args: ['-p', '{{prompt}}'],
    resumeArgs: ['--resume', '{{prompt}}'],
    interactiveArgs: [],
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli'
  },
  {
    id: 'kilo',
    name: 'Kilo Code',
    command: 'kilo',
    args: ['run', '{{prompt}}'],
    resumeArgs: ['--continue'],
    interactiveArgs: [],
    docsUrl: 'https://kilo.ai/docs'
  }
];
