import { failStaleTasks, markStaleAgentsOffline, recomputeAllAgents } from './service.js';
import { scheduleSummaryBroadcast } from './hub.js';

export function reconcileOnce(): void {
  const staleAgents = markStaleAgentsOffline();
  const agentsFixed = recomputeAllAgents();
  const staleTasks = failStaleTasks();
  if (staleAgents || staleTasks || agentsFixed) scheduleSummaryBroadcast();
}

let timer: NodeJS.Timeout | null = null;

export function startReconcile(): void {
  if (timer) return;
  timer = setInterval(() => {
    try {
      reconcileOnce();
    } catch (error) {
      console.error('[dorado] rekonsiliasi error', error);
    }
  }, 60_000);
  timer.unref();
  setTimeout(() => {
    try {
      reconcileOnce();
    } catch (error) {
      console.error('[dorado] rekonsiliasi error', error);
    }
  }, 5000).unref();
}

export function stopReconcile(): void {
  if (timer) clearInterval(timer);
  timer = null;
}