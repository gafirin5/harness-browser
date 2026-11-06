import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { NotificationItem, Project, SessionHistoryItem } from '@dorado/shared';

type DashboardTab = 'board' | 'inbox';

const COLUMNS: Array<{ key: SessionHistoryItem['status']; title: string; tone: string }> = [
  { key: 'failed', title: 'Needs You', tone: 'danger' },
  { key: 'running', title: 'Working', tone: 'accent' },
  { key: 'completed', title: 'Done', tone: 'ok' },
  { key: 'stopped', title: 'Idle', tone: 'muted' }
];

function formatTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function AgentDashboard({
  sessions,
  loading,
  projects,
  selectedProjectId,
  inboxRead,
  notifications,
  initialTab = 'board',
  onClose,
  onRefresh,
  onOpenSession,
  onRerun,
  onStop,
  onMarkRead,
  onMarkAllRead,
  onMarkNotificationRead,
  onMarkAllNotificationsRead
}: {
  sessions: SessionHistoryItem[];
  loading: boolean;
  projects: Project[];
  selectedProjectId: string | null;
  inboxRead: string[];
  notifications: NotificationItem[];
  initialTab?: DashboardTab;
  onClose: () => void;
  onRefresh: () => void;
  onOpenSession: (session: SessionHistoryItem) => void;
  onRerun: (session: SessionHistoryItem) => void;
  onStop: (session: SessionHistoryItem) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: (ids: string[]) => void;
  onMarkNotificationRead: (id: string) => void;
  onMarkAllNotificationsRead: () => void;
}): JSX.Element {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [projectFilter, setProjectFilter] = useState<string>(selectedProjectId ?? 'all');

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(
    () => (projectFilter === 'all' ? sessions : sessions.filter((session) => session.projectId === projectFilter)),
    [sessions, projectFilter]
  );

  const readSet = useMemo(() => new Set(inboxRead), [inboxRead]);
  const inbox = useMemo(
    () => filtered.filter((session) => session.status === 'completed' || session.status === 'failed'),
    [filtered]
  );
  const unreadIds = useMemo(
    () => inbox.filter((session) => !readSet.has(session.id)).map((s) => s.id),
    [inbox, readSet]
  );
  const unreadNotificationCount = notifications.filter((item) => !item.read).length;
  const totalUnread = unreadIds.length + unreadNotificationCount;

  const open = (session: SessionHistoryItem): void => {
    onMarkRead(session.id);
    onOpenSession(session);
  };

  return createPortal(
    <div
      className="orch-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="orch-panel agent-dashboard" role="dialog" aria-modal="true" aria-label="Agent Dashboard">
        <div className="orch-head">
          <h2 style={{ margin: 0, fontSize: 14 }}>Agent Dashboard</h2>
          <div className="dashboard-tabs">
            <button className={`orch-tab ${tab === 'board' ? 'active' : ''}`} onClick={() => setTab('board')}>
              Board
            </button>
            <button className={`orch-tab ${tab === 'inbox' ? 'active' : ''}`} onClick={() => setTab('inbox')}>
              Inbox{totalUnread > 0 ? ` (${totalUnread})` : ''}
            </button>
          </div>
          <span className="topbar-spacer" />
          <select
            className="input tiny"
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            aria-label="Filter project"
          >
            <option value="all">Semua project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <button className="btn tiny" onClick={onRefresh} disabled={loading}>
            {loading ? 'Memuat...' : 'Muat Ulang'}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup" title="Tutup">
            ×
          </button>
        </div>

        {tab === 'board' ? (
          <div className="dashboard-board">
            {COLUMNS.map((column) => {
              const items = filtered
                .filter((session) => session.status === column.key)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
              return (
                <section className="dashboard-column" key={column.key}>
                  <header className={`dashboard-column-head ${column.tone}`}>
                    <span>{column.title}</span>
                    <span className="dashboard-count">{items.length}</span>
                  </header>
                  <div className="dashboard-column-body">
                    {items.length === 0 ? <div className="dashboard-empty">Tidak ada sesi.</div> : null}
                    {items.map((session) => (
                      <article className={`dashboard-card ${readSet.has(session.id) ? '' : 'unread'}`} key={session.id}>
                        <button className="dashboard-card-main" onClick={() => open(session)}>
                          <span className="dashboard-card-title">{session.title}</span>
                          <span className="dashboard-card-meta">
                            {session.projectName} · <span className="mono">{session.worktreeBranch}</span>
                          </span>
                          <span className="dashboard-card-prompt">
                            {session.prompt || 'Sesi interaktif tanpa prompt awal.'}
                          </span>
                          <span className="dashboard-card-time">{formatTime(session.createdAt)}</span>
                        </button>
                        <div className="dashboard-card-actions">
                          {session.status === 'running' ? (
                            <button className="btn tiny" onClick={() => onStop(session)}>
                              Stop
                            </button>
                          ) : (
                            <button className="btn tiny" onClick={() => onRerun(session)}>
                              ↻ Resume
                            </button>
                          )}
                          <button className="btn tiny ghost" onClick={() => open(session)}>
                            Buka
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="dashboard-inbox">
            {notifications.length > 0 ? (
              <div className="dashboard-notification-block">
                <div className="dashboard-inbox-head">
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    Notifikasi sistem · {unreadNotificationCount} belum dibaca
                  </span>
                  <button
                    className="btn tiny"
                    onClick={onMarkAllNotificationsRead}
                    disabled={unreadNotificationCount === 0}
                  >
                    Tandai Semua Dibaca
                  </button>
                </div>
                <div className="dashboard-inbox-list">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      className={`dashboard-inbox-row ${notification.read ? '' : 'unread'}`}
                      onClick={() => onMarkNotificationRead(notification.id)}
                    >
                      <span className="dot off" />
                      <span className="dashboard-inbox-info">
                        <span className="dashboard-inbox-title">{notification.title}</span>
                        <span className="dashboard-inbox-meta">{notification.body}</span>
                      </span>
                      <span className="dashboard-inbox-time">{formatTime(notification.createdAt)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="dashboard-inbox-head">
              <span className="muted" style={{ fontSize: 11.5 }}>
                {unreadIds.length} belum dibaca dari {inbox.length} sesi selesai/gagal.
              </span>
              <button
                className="btn tiny"
                onClick={() => onMarkAllRead(inbox.map((session) => session.id))}
                disabled={unreadIds.length === 0}
              >
                Tandai Semua Dibaca
              </button>
            </div>
            {inbox.length === 0 ? <div className="empty">Belum ada notifikasi sesi.</div> : null}
            <div className="dashboard-inbox-list">
              {inbox.map((session) => (
                <button
                  key={session.id}
                  className={`dashboard-inbox-row ${readSet.has(session.id) ? '' : 'unread'}`}
                  onClick={() => open(session)}
                >
                  <span className={`dot ${session.status === 'failed' ? 'off' : ''}`} />
                  <span className="dashboard-inbox-info">
                    <span className="dashboard-inbox-title">{session.title}</span>
                    <span className="dashboard-inbox-meta">
                      {session.status === 'failed' ? 'Gagal' : 'Selesai'} · {session.projectName} ·{' '}
                      <span className="mono">{session.worktreeBranch}</span>
                    </span>
                  </span>
                  <span className="dashboard-inbox-time">{formatTime(session.endedAt ?? session.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
