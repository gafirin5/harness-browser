import fs from 'node:fs';

function safeRealpath(target: string): string | null {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

/** Baca socket LISTEN dari /proc/net/tcp(6): Map<inode, port>. */
function readListenSockets(): Map<string, number> {
  const result = new Map<string, number>();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split('\n').slice(1);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 10) continue;
      if (fields[3] !== '0A') continue; // 0A = LISTEN
      const local = fields[1] ?? '';
      const portHex = local.split(':')[1];
      if (!portHex) continue;
      const port = parseInt(portHex, 16);
      const inode = fields[9];
      if (Number.isInteger(port) && port > 0 && inode) result.set(inode, port);
    }
  }
  return result;
}

/** Petakan inode socket ke PID dengan menelusuri /proc/<pid>/fd (best-effort). */
function mapInodeToPid(targets: Set<string>): Map<string, number> {
  const mapping = new Map<string, number>();
  let pids: string[];
  try {
    pids = fs.readdirSync('/proc');
  } catch {
    return mapping;
  }
  let scanned = 0;
  for (const pid of pids) {
    if (!/^\d+$/.test(pid)) continue;
    if (scanned >= 4000) break;
    scanned += 1;
    let fds: string[];
    try {
      fds = fs.readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link: string;
      try {
        link = fs.readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(link);
      if (match && targets.has(match[1] as string)) {
        mapping.set(match[1] as string, Number(pid));
      }
    }
  }
  return mapping;
}

/**
 * Deteksi port TCP LISTEN yang prosesnya berjalan di dalam worktree.
 * Best-effort dan hanya untuk Linux; kembalikan [] bila tidak terdeteksi.
 */
export function detectWorktreePorts(worktreePath: string): number[] {
  const worktreeReal = safeRealpath(worktreePath);
  if (!worktreeReal) return [];
  const listen = readListenSockets();
  if (listen.size === 0) return [];
  const pidByInode = mapInodeToPid(new Set(listen.keys()));
  const ports = new Set<number>();
  for (const [inode, port] of listen) {
    const pid = pidByInode.get(inode);
    if (!pid) continue;
    const cwd = safeRealpath(`/proc/${pid}/cwd`);
    if (cwd && (cwd === worktreeReal || cwd.startsWith(`${worktreeReal}/`))) ports.add(port);
  }
  return Array.from(ports).sort((a, b) => a - b);
}
