import { useEffect, useMemo, useRef, useState } from 'react';
import type CodeMirror from 'codemirror';
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
  jumpLine?: number;
  jumpToken?: number;
}

function modeFor(language: string): string | CodeMirror.EditorConfiguration['mode'] {
  switch (language) {
    case 'typescript':
      return { name: 'javascript', typescript: true };
    case 'javascript':
      return 'javascript';
    case 'json':
      return { name: 'javascript', json: true };
    case 'markdown':
      return 'markdown';
    case 'css':
      return 'css';
    case 'html':
      return { name: 'xml', htmlMode: true };
    case 'shell':
      return 'shell';
    case 'python':
      return 'python';
    case 'sql':
      return 'sql';
    case 'yaml':
      return 'yaml';
    default:
      return null;
  }
}

async function ensureMode(language: string): Promise<void> {
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'json':
      await import('codemirror/mode/javascript/javascript.js');
      break;
    case 'css':
      await import('codemirror/mode/css/css.js');
      break;
    case 'html':
      await import('codemirror/mode/xml/xml.js');
      break;
    case 'markdown':
      await import('codemirror/mode/markdown/markdown.js');
      break;
    case 'shell':
      await import('codemirror/mode/shell/shell.js');
      break;
    case 'python':
      await import('codemirror/mode/python/python.js');
      break;
    case 'sql':
      await import('codemirror/mode/sql/sql.js');
      break;
    case 'yaml':
      await import('codemirror/mode/yaml/yaml.js');
      break;
    default:
      break;
  }
}

export function FileEditor({
  worktreeId,
  filePath,
  onDirtyChange,
  jumpLine,
  jumpToken
}: FileEditorProps): JSX.Element {
  const { push } = useToast();
  const [content, setContent] = useState('');
  const [original, setOriginal] = useState('');
  const [meta, setMeta] = useState<{ binary: boolean; size: number; language: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeMirror.Editor | null>(null);
  const contentRef = useRef('');
  const saveRef = useRef<() => void>(() => undefined);

  contentRef.current = content;
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
    if (!dirty || saving) return;
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
  saveRef.current = () => void save();

  useEffect(() => {
    if (loading || meta?.binary || !hostRef.current) return undefined;
    let disposed = false;
    let editor: CodeMirror.Editor | null = null;
    const language = meta?.language ?? 'text';

    void (async () => {
      await ensureMode(language);
      const module = await import('codemirror');
      if (disposed || !hostRef.current) return;
      const CodeMirrorEditor = module.default;
      editor = CodeMirrorEditor(hostRef.current, {
        value: contentRef.current,
        mode: modeFor(language),
        theme: 'dorado',
        lineNumbers: true,
        lineWrapping: false,
        indentUnit: 2,
        tabSize: 2,
        viewportMargin: 30,
        extraKeys: {
          'Ctrl-S': () => saveRef.current(),
          'Cmd-S': () => saveRef.current()
        }
      });
      editor.on('change', () => setContent(editor?.getValue() ?? ''));
      editorRef.current = editor;
      setEditorReady(true);
      window.setTimeout(() => editor?.refresh(), 30);
    })();

    return () => {
      disposed = true;
      editorRef.current = null;
      setEditorReady(false);
      if (editor) editor.getWrapperElement().remove();
    };
  }, [loading, meta?.binary, meta?.language]);

  useEffect(() => {
    if (!editorReady || !jumpLine) return;
    const editor = editorRef.current;
    if (!editor) return;
    const target = Math.max(0, Math.min(editor.lineCount() - 1, jumpLine - 1));
    editor.setCursor({ line: target, ch: 0 });
    editor.scrollIntoView({ line: target, ch: 0 }, 80);
    editor.focus();
  }, [editorReady, jumpLine, jumpToken]);

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
        <>
          <div className="editor-cm" ref={hostRef} />
          {!editorReady ? <div className="empty">Menyiapkan editor...</div> : null}
        </>
      )}
    </div>
  );
}