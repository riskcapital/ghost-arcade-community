// Helpers for user-selected local asset files in the Electron shell.
//
// Browser blob URLs are scoped to the renderer process that created them.
// Projection output runs in a second renderer, so point clouds / models need a
// durable source that both windows can read. In Electron we store the real file
// path and read bytes through a narrow IPC bridge; in the browser we keep using
// normal blob/data/http URLs.

export function getPathForFile(file: File): string {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (api?.getPathForFile) {
    try {
      return api.getPathForFile(file) || '';
    } catch {
      return '';
    }
  }

  return ((file as any).path as string | undefined) || '';
}

export function isLocalFileSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return (
    /^file:/i.test(source) ||
    /^[a-zA-Z]:[\\/]/.test(source) ||
    source.startsWith('\\\\')
  );
}

export function shouldUseAnonymousCrossOrigin(source: string | null | undefined): boolean {
  return !!source && (/^https?:/i.test(source) || /^ghost-media:/i.test(source));
}

export function isSharedLocalMediaUrl(source: string | null | undefined): boolean {
  return !!source && /^ghost-media:/i.test(source);
}

export async function registerLocalMediaSource(source: string): Promise<string> {
  if (!isLocalFileSource(source) || typeof window === 'undefined') {
    return source;
  }

  const api = (window as any).electronAPI;
  if (!api?.invoke) return source;

  const result = await api.invoke('register_local_media_file', { path: source });
  if (!result?.success || !result.url) {
    throw new Error(result?.error || 'Failed to register local media file');
  }
  return result.url;
}

export async function createSharedMediaUrl(file: File): Promise<{ url: string; localPath?: string; revoke: () => void }> {
  const localPath = getPathForFile(file);
  if (localPath) {
    try {
      const url = await registerLocalMediaSource(localPath);
      return { url, localPath, revoke: () => {} };
    } catch (err) {
      console.warn('[LocalMedia] Falling back to blob URL:', err);
    }
  }

  const url = URL.createObjectURL(file);
  return { url, localPath: localPath || undefined, revoke: () => URL.revokeObjectURL(url) };
}

function bytesToArrayBuffer(bytes: unknown): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes.slice(0);
  }

  if (ArrayBuffer.isView(bytes)) {
    const view = bytes as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy.buffer;
  }

  if (Array.isArray(bytes)) {
    return Uint8Array.from(bytes).buffer;
  }

  if (bytes && typeof bytes === 'object' && Array.isArray((bytes as any).data)) {
    return Uint8Array.from((bytes as any).data).buffer;
  }

  throw new Error('Local asset bridge returned invalid byte data');
}

function dataUrlToArrayBuffer(source: string): ArrayBuffer {
  const comma = source.indexOf(',');
  if (comma < 0) throw new Error('Invalid data URL');

  const meta = source.slice(0, comma);
  const data = source.slice(comma + 1);

  if (/;base64/i.test(meta)) {
    const binary = atob(data);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
  }

  const text = decodeURIComponent(data);
  const encoded = new TextEncoder().encode(text);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

export async function readLocalAssetFile(source: string): Promise<ArrayBuffer> {
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (!api?.invoke) {
    throw new Error('Local asset loading is only available in the desktop app');
  }

  const result = await api.invoke('read_local_asset_file', { path: source });
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to read local asset file');
  }

  return bytesToArrayBuffer(result.bytes);
}

export async function loadAssetArrayBuffer(source: string): Promise<ArrayBuffer> {
  if (/^data:/i.test(source)) {
    return dataUrlToArrayBuffer(source);
  }

  if (isLocalFileSource(source) && typeof window !== 'undefined' && (window as any).electronAPI?.invoke) {
    return readLocalAssetFile(source);
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

export async function createLoadableAssetUrl(
  source: string,
  mimeType = 'application/octet-stream'
): Promise<{ url: string; revoke: () => void }> {
  if (!isLocalFileSource(source) || typeof window === 'undefined' || !(window as any).electronAPI?.invoke) {
    return { url: source, revoke: () => {} };
  }

  const buffer = await readLocalAssetFile(source);
  const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
  return {
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}
