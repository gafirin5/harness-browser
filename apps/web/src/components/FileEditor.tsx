import { useEffect, useMemo, useState } from 'react';
import { ApiError, apiGet, request } from '../lib/api';
import { useToast } from './ui';

interface FileContentResponse {
  data: {
    path: string;
    binary: boolean;
    size: number;
    language: string;
    content: string;
  };
}

interface FileEditorProps {
  worktreeId: string;
  filePath: string;
  onDirtyChange: (path: string, dirty: boolean) => void;
}

export function FileEditor({ worktreeId, filePath, onDirtyChange }: FileEditorProps): JSX.Element {
  const { push } = useToast();
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [meta, setMeta] = useState<{ binary: boolean; size: number; language: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = content !== original;

  useEffect(() => {
    onDirtyChange(filePath, dirty);
  }, [dirty, filePath, onDirtyChange]);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiGet<FileContentResponse>(
        `/files/content?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(filePath)}`
      );
      setMeta({ binary: response.data.binary, size: response.data.size, language: response.data.language });
      setContent(response.data.content);
      setOriginal(response.data.content);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal memuat file.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktreeId, filePath]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await request(`/files/content`, {
        method: 'PUT',
        body: { worktreeId, path: filePath, content }
      });
      setOriginal(content);
      push('success', 'File disimpan.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal menyimpan file.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (dirty && !saving) void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sizeLabel = useMemo(() => {
    if (!meta) return '';
    if (meta.size < 1024) return `${meta.size} B`;
    return `${(meta.size / 1024).toFixed(1)} KB`;
  }, [meta]);

  return (
    <div className="editor">
      <div className="editor-head">
        <span className="mono" style={{ color: 'var(--text)' }}>
          {filePath}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {meta?.language ?? ''} {sizeLabel ? `· ${sizeLabel}` : ''} {dirty ? '· belum disimpan' : ''}
        </span>
        <span className="spacer" />
        <button className="btn tiny" onClick={() => void load()} disabled={loading || saving}>
          Muat Ulang
        </button>
        <button className="btn tiny primary" onClick={() => void save()} disabled={!dirty || saving} title="Ctrl+S">
          {saving ? 'Menyimpan...' : 'Simpan'}
        </button>
      </div>
      {error ? <div className="error-banner" style={{ margin: 10 }}>{error}</div> : null}
      {loading ? (
        <div className="empty">Memuat file...</div>
      ) : meta?.binary ? (
        <div className="empty">File biner tidak dapat ditampilkan di editor teks.</div>
      ) : (
        <textarea
          className="editor-textarea"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          wrap="off"
          aria-label={`Editor ${filePath}`}
        />
      )}
    </div>
  );
}