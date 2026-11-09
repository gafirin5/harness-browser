import { useCallback, useRef, useState } from 'react';
import type { Worktree } from '@dorado/shared';
import { ApiError, apiGet, apiPost, uploadAttachmentBlob } from '../lib/api';
import { Field, Modal, useToast } from './ui';

type Kind = 'image' | 'pdf' | 'csv' | 'json' | 'other';
type Tool = 'rect' | 'pen' | 'arrow' | 'text';
interface Shape {
  tool: Tool;
  color: string;
  points: Array<{ x: number; y: number }>;
  text?: string;
}

function kindOf(filePath: string): Kind {
  const ext = filePath.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  if (ext === 'json') return 'json';
  return 'other';
}

function parseRows(text: string, sep: string): string[][] {
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(0, 500)
    .map((line) => line.split(sep));
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = 3;
  const first = shape.points[0];
  const last = shape.points[shape.points.length - 1];
  if (shape.tool === 'rect' && first && last) {
    ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
  } else if (shape.tool === 'pen') {
    ctx.beginPath();
    shape.points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.stroke();
  } else if (shape.tool === 'arrow' && first && last) {
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    const angle = Math.atan2(last.y - first.y, last.x - first.x);
    const size = 16;
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x - size * Math.cos(angle - 0.4), last.y - size * Math.sin(angle - 0.4));
    ctx.lineTo(last.x - size * Math.cos(angle + 0.4), last.y - size * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  } else if (shape.tool === 'text' && first && shape.text) {
    ctx.font = '20px sans-serif';
    ctx.fillText(shape.text, first.x, first.y);
  }
  ctx.restore();
}

export function FilePreviewDialog({
  worktrees,
  selectedWorktreeId,
  activeTerminalId,
  onClose
}: {
  worktrees: Worktree[];
  selectedWorktreeId: string | null;
  activeTerminalId: string | null;
  onClose: () => void;
}): JSX.Element {
  const { push } = useToast();
  const [worktreeId, setWorktreeId] = useState(selectedWorktreeId ?? worktrees[0]?.id ?? '');
  const [filePath, setFilePath] = useState('');
  const [kind, setKind] = useState<Kind | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [tool, setTool] = useState<Tool>('rect');
  const [color, setColor] = useState('#ef4444');
  const [version, setVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const drawingRef = useRef<{ active: boolean; shape: Shape | null }>({ active: false, shape: null });

  const rawUrl = `/api/files/preview?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(filePath)}`;

  const redraw = useCallback((): void => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const shapes = drawingRef.current.shape ? [...shapesRef.current, drawingRef.current.shape] : shapesRef.current;
    for (const shape of shapes) drawShape(ctx, shape);
  }, []);

  const load = async (): Promise<void> => {
    setError(null);
    setText('');
    setAnnotating(false);
    shapesRef.current = [];
    if (!filePath.trim()) {
      setError('Masukkan path file.');
      return;
    }
    const detected = kindOf(filePath);
    setKind(detected);
    if (detected === 'csv' || detected === 'json') {
      try {
        const response = await apiGet<{ data: { content: string; binary: boolean } }>(
          `/files/content?worktreeId=${encodeURIComponent(worktreeId)}&path=${encodeURIComponent(filePath)}`
        );
        if (response.data.binary) {
          setError('File biner tidak dapat ditampilkan sebagai teks.');
          return;
        }
        setText(response.data.content);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Gagal memuat file.');
      }
    }
  };

  const startAnnotate = (): void => {
    setError(null);
    const image = new Image();
    image.onload = () => {
      imgRef.current = image;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxWidth = 1600;
      const scale = image.naturalWidth > maxWidth ? maxWidth / image.naturalWidth : 1;
      canvas.width = Math.round(image.naturalWidth * scale) || 1;
      canvas.height = Math.round(image.naturalHeight * scale) || 1;
      shapesRef.current = [];
      drawingRef.current = { active: false, shape: null };
      setAnnotating(true);
      window.setTimeout(redraw, 0);
    };
    image.onerror = () => setError('Gagal memuat gambar untuk anotasi.');
    image.src = rawUrl;
  };

  const pointFromEvent = (event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const onDown = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    if (tool === 'text') {
      const value = window.prompt('Teks label:');
      if (value) {
        shapesRef.current.push({ tool: 'text', color, points: [pointFromEvent(event)], text: value });
        setVersion((current) => current + 1);
        redraw();
      }
      return;
    }
    drawingRef.current = { active: true, shape: { tool, color, points: [pointFromEvent(event)] } };
  };

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>): void => {
    const drawing = drawingRef.current;
    if (!drawing.active || !drawing.shape) return;
    const point = pointFromEvent(event);
    const startPoint = drawing.shape.points[0] ?? point;
    drawing.shape.points = tool === 'pen' ? [...drawing.shape.points, point] : [startPoint, point];
    redraw();
  };

  const onUp = (): void => {
    const drawing = drawingRef.current;
    if (drawing.active && drawing.shape) shapesRef.current.push(drawing.shape);
    drawingRef.current = { active: false, shape: null };
    setVersion((current) => current + 1);
    redraw();
  };

  const undo = (): void => {
    shapesRef.current.pop();
    redraw();
  };

  const sendAnnotated = async (): Promise<void> => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((value) => resolve(value), 'image/png'));
    if (!blob) {
      setError('Gagal mengekspor gambar.');
      return;
    }
    try {
      const result = await uploadAttachmentBlob(worktreeId, `annotated-${Date.now()}.png`, blob);
      if (activeTerminalId) await apiPost(`/terminals/${activeTerminalId}/input`, { data: `@${result.path} ` });
      push('success', `Gambar anotasi dikirim: ${result.path}`);
      setAnnotating(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Gagal mengirim gambar.');
    }
  };

  const rows = kind === 'csv' ? parseRows(text, filePath.toLowerCase().endsWith('.tsv') ? '\t' : ',') : [];

  return (
    <Modal
      title="Pratinjau File"
      onClose={onClose}
      wide
      footer={
        <button className="btn" onClick={onClose}>
          Tutup
        </button>
      }
    >
      {error ? <div className="error-banner">{error}</div> : null}

      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <Field label="Worktree">
          <select className="select" value={worktreeId} onChange={(event) => setWorktreeId(event.target.value)}>
            {worktrees.map((worktree) => (
              <option key={worktree.id} value={worktree.id}>
                {worktree.branch}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Path file">
          <input
            className="input"
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
            placeholder="docs/spec.pdf atau data.csv"
          />
        </Field>
        <button className="btn tiny primary" onClick={() => void load()}>
          Muat
        </button>
      </div>

      {kind === 'image' ? (
        annotating ? (
          <div className="annotator">
            <div className="annotator-tools">
              {(['rect', 'pen', 'arrow', 'text'] as Tool[]).map((item) => (
                <button
                  key={item}
                  className={`btn tiny ${tool === item ? 'primary' : ''}`}
                  onClick={() => setTool(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label="Warna" />
              <button className="btn tiny" onClick={undo} type="button">
                ↺ Undo
              </button>
              <button className="btn tiny" onClick={() => void sendAnnotated()} type="button">
                Simpan & Kirim ke Agent
              </button>
            </div>
            <canvas
              ref={canvasRef}
              className="annotator-canvas"
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
              data-version={version}
            />
          </div>
        ) : (
          <div>
            <img className="preview-image" src={rawUrl} alt="Pratinjau" />
            <div className="orch-form-actions">
              <button className="btn tiny" onClick={startAnnotate} type="button">
                ✏️ Annotate & Kirim
              </button>
            </div>
          </div>
        )
      ) : kind === 'pdf' ? (
        <iframe className="preview-frame" src={rawUrl} title="PDF" />
      ) : kind === 'csv' ? (
        <div className="preview-table-wrap">
          <table className="preview-table">
            <thead>
              <tr>
                {(rows[0] ?? []).map((cell, index) => (
                  <th key={index}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : kind === 'json' ? (
        <pre className="preview-text">{text}</pre>
      ) : kind === 'other' ? (
        <div className="empty">Tipe file ini belum didukung untuk pratinjau.</div>
      ) : null}
    </Modal>
  );
}
