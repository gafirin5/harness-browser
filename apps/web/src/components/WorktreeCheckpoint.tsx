import { useEffect, useState } from 'react';
import type { Worktree, WorktreeTaskStatus } from '@dorado/shared';
import { ApiError, apiPatch } from '../lib/api';
import { useToast } from './ui';

const STATUSES: Array<{ value: WorktreeTaskStatus; label: string }> = [
  { value: 'todo', label: 'Todo' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'in-review', label: 'In review' },
  { value: 'completed', label: 'Completed' }
];

export function checkpointLabel(status: WorktreeTaskStatus): string {
  return STATUSES.find((item) => item.value === status)?.label ?? 'Todo';
}

export function WorktreeCheckpoint({
  worktree,
  onUpdated
}: {
  worktree: Worktree;
  onUpdated: (worktree: Worktree) => void;
}): JSX.Element {
  const { push } = useToast();
  const [status, setStatus] = useState<WorktreeTaskStatus>(worktree.taskStatus);
  const [note, setNote] = useState(worktree.note);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStatus(worktree.taskStatus);
    setNote(worktree.note);
  }, [worktree.id, worktree.taskStatus, worktree.note]);

  const save = async (nextStatus: WorktreeTaskStatus, nextNote: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await apiPatch<{ data: Worktree }>(`/worktrees/${worktree.id}`, {
        taskStatus: nextStatus,
        note: nextNote
      });
      onUpdated(response.data);
      push('success', 'Checkpoint worktree disimpan.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan checkpoint.');
    } finally {
      setSaving(false);
    }
  };

  const dirty = status !== worktree.taskStatus || note !== worktree.note;

  return (
    <div className="worktree-checkpoint">
      <div className="worktree-checkpoint-head">
        <select
          className={`checkpoint-select ${status}`}
          value={status}
          aria-label={`Checkpoint ${worktree.branch}`}
          onChange={(event) => {
            const next = event.target.value as WorktreeTaskStatus;
            setStatus(next);
            void save(next, note);
          }}
          disabled={saving}
        >
          {STATUSES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        {saving ? (
          <span className="muted" style={{ fontSize: 10 }}>
            Menyimpan...
          </span>
        ) : null}
      </div>
      <textarea
        className="textarea checkpoint-note"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Catatan checkpoint untuk worktree ini..."
        maxLength={2000}
        aria-label={`Catatan checkpoint ${worktree.branch}`}
      />
      {dirty ? (
        <div className="worktree-checkpoint-actions">
          <button
            className="btn tiny ghost"
            onClick={() => {
              setStatus(worktree.taskStatus);
              setNote(worktree.note);
            }}
            disabled={saving}
          >
            Batal
          </button>
          <button className="btn tiny primary" onClick={() => void save(status, note)} disabled={saving}>
            Simpan Catatan
          </button>
        </div>
      ) : null}
      {error ? <div className="error-banner">{error}</div> : null}
    </div>
  );
}
