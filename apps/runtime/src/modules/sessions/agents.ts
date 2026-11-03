import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AgentInfo } from '@dorado/shared';
import { config } from '../../config.js';

interface AgentDefinition {
  id: string;
  name: string;
  command: string;
  args: string[];
}

const builtins: AgentDefinition[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    command: 'opencode',
    args: ['--prompt', '{{prompt}}']
  }
];

export function isInstalled(command: string): boolean {
  if (command.includes('/')) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function listAgents(): AgentInfo[] {
  const all = [...builtins, ...config.extraAgents];
  return all.map((agent) => ({
    id: agent.id,
    name: agent.name,
    command: agent.command,
    args: agent.args,
    installed: isInstalled(agent.command)
  }));
}

export function getAgent(id: string): (AgentDefinition & { installed: boolean }) | null {
  const agent = [...builtins, ...config.extraAgents].find((item) => item.id === id);
  if (!agent) return null;
  return { ...agent, installed: isInstalled(agent.command) };
}

export function buildAgentArgs(args: string[], prompt: string): string[] {
  return args.map((arg) => arg.replaceAll('{{prompt}}', prompt));
}