export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
}

let activeNodeId: string | null = null;

export function setActiveNodeId(nodeId: string | null): void {
  activeNodeId = nodeId;
}

export function getActiveNodeId(): string | null {
  return activeNodeId;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (activeNodeId) {
    headers['x-dorado-node-id'] = activeNodeId;
  }

  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)
      ?.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `Permintaan gagal (HTTP ${response.status}).`,
      error?.fields
    );
  }
  return payload as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body });
}
export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body });
}
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body });
}
export function apiDelete<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export function terminalWsUrl(terminalId: string): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const query = activeNodeId ? `?nodeId=${encodeURIComponent(activeNodeId)}` : '';
  return `${protocol}//${location.host}/ws/terminals/${terminalId}${query}`;
}

export async function uploadAttachment(worktreeId: string, file: File): Promise<{ path: string; mention: string }> {
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
  if (activeNodeId) headers['x-dorado-node-id'] = activeNodeId;
  const response = await fetch(`/api/worktrees/${worktreeId}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: file
  });
  const text = await response.text();
  let payload: { data?: { path: string; mention: string }; error?: { message?: string } } | null = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok || !payload?.data) {
    throw new ApiError(
      response.status,
      'HTTP_ERROR',
      payload?.error?.message ?? `Upload gagal (HTTP ${response.status}).`
    );
  }
  return payload.data;
}

export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.className = 'clipboard-helper';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.queryCommandSupported('copy') && document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(textarea);
  return ok;
}
