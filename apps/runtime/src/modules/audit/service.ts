import type { AuditAction, AuditEntry } from '@dorado/shared';
import { db, nowIso } from '../../db/index.js';

interface AuditRow {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  ip: string | null;
  created_at: string;
}

export interface AuditInput {
  userId?: number | null;
  username?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | number | null;
  detail?: string | null;
  ip?: string | null;
}

function mapRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    detail: row.detail,
    ip: row.ip,
    createdAt: row.created_at
  };
}

export function recordAudit(input: AuditInput): void {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, action, target_type, target_id, detail, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.userId ?? null,
    input.username ?? null,
    input.action,
    input.targetType ?? null,
    input.targetId === undefined || input.targetId === null ? null : String(input.targetId),
    input.detail ?? null,
    input.ip ?? null,
    nowIso()
  );
}

export interface AuditFilters {
  limit: number;
  offset: number;
  action?: string;
  q?: string;
}

export function listAuditLogs(filters: AuditFilters): { data: AuditEntry[]; total: number } {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.action) {
    where.push('action = ?');
    params.push(filters.action);
  }
  if (filters.q) {
    where.push('(lower(username) LIKE ? OR lower(detail) LIKE ?)');
    const pattern = `%${filters.q.toLowerCase()}%`;
    params.push(pattern, pattern);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT count(*) AS total FROM audit_logs ${whereSql}`).get(...params) as { total: number })
    .total;
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, filters.limit, filters.offset) as unknown as AuditRow[];
  return { data: rows.map(mapRow), total };
}
