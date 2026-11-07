import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { AgentInfo } from '@dorado/shared';
import { config } from '../../config.js';
import { AGENT_PRESETS, type AgentDefinition } from './agent-presets.js';
import { listStoredAgents } from './agent-store.js';

export type AgentInvocationMode = 'run' | 'resume';
export type AgentSource = 'builtin' | 'env' | 'custom';

export interface ResolvedAgent extends AgentDefinition {
  source: AgentSource;
  installed: boolean;
}

const INSTALL_TTL_MS = 30_000;
const installCache = new Map<string, { at: number; installed: boolean }>();

function checkInstalled(command: string): boolean {
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

export function isInstalled(command: string): boolean {
  const now = Date.now();
  const cached = installCache.get(command);
  if (cached && now - cached.at < INSTALL_TTL_MS) return cached.installed;
  const installed = checkInstalled(command);
  installCache.set(command, { at: now, installed });
  return installed;
}

/**
 * Gabungkan preset bawaan, agent dari `DORADO_AGENTS`, dan agent kustom (DB).
 * Agent dengan `id` yang sama menimpa entri sebelumnya:
 * preset < env < kustom.
 */
export function resolveAgents(): ResolvedAgent[] {
  const byId = new Map<string, Omit<ResolvedAgent, 'installed'>>();
  for (const preset of AGENT_PRESETS) {
    byId.set(preset.id, { ...preset, source: 'builtin' });
  }
  for (const extra of config.extraAgents) {
    byId.set(extra.id, { ...extra, source: 'env' });
  }
  for (const stored of listStoredAgents()) {
    byId.set(stored.id, { ...stored, source: 'custom' });
  }
  return Array.from(byId.values()).map((agent) => ({ ...agent, installed: isInstalled(agent.command) }));
}

function toAgentInfo(agent: ResolvedAgent): AgentInfo {
  return {
    id: agent.id,
    name: agent.name,
    command: agent.command,
    args: agent.args,
    resumeArgs: agent.resumeArgs,
    interactiveArgs: agent.interactiveArgs,
    docsUrl: agent.docsUrl,
    source: agent.source,
    builtin: agent.source === 'builtin',
    installed: agent.installed
  };
}

export function listAgents(): AgentInfo[] {
  return resolveAgents().map(toAgentInfo);
}

export function getAgent(id: string): ResolvedAgent | null {
  return resolveAgents().find((item) => item.id === id) ?? null;
}

export function buildAgentArgs(args: string[], prompt: string): string[] {
  if (!prompt.trim()) {
    // Tanpa prompt, buka agent secara interaktif. Buang pasangan --prompt.
    const index = args.indexOf('--prompt');
    if (index >= 0) return [...args.slice(0, index), ...args.slice(index + 2)];
  }
  return args.map((arg) => arg.replaceAll('{{prompt}}', prompt));
}

/**
 * Tentukan argumen untuk menjalankan agent.
 * - Prompt kosong → pakai `interactiveArgs` bila agent mendefinisikannya.
 * - Selain itu → substitusi `{{prompt}}` pada args mode run/resume.
 */
export function agentCommandArgs(agent: AgentDefinition, prompt: string, mode: AgentInvocationMode = 'run'): string[] {
  if (!prompt.trim() && agent.interactiveArgs) {
    return [...agent.interactiveArgs];
  }
  const base = mode === 'resume' ? (agent.resumeArgs ?? agent.args) : agent.args;
  return buildAgentArgs(base, prompt);
}
