/**
 * A project in a link. The project file is compressed (deflate) and written into the part of the address
 * after "#", which browsers do not send to any server: the model travels in the link itself.
 */
import type { ProjectFile } from '../core/types';

const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64 = (text: string): Uint8Array => { const s = atob(text.replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}
export async function encodeProject(p: ProjectFile): Promise<string> {
  const { view: _view, ...rest } = p as ProjectFile & { view?: unknown };
  return b64(await pipe(new TextEncoder().encode(JSON.stringify(rest)), new CompressionStream('deflate-raw')));
}
export async function decodeProject(code: string): Promise<unknown> {
  if (code.length > 2_000_000) throw new Error('The link is too long');
  const bytes = await pipe(unb64(code), new DecompressionStream('deflate-raw'));
  if (bytes.length > 20_000_000) throw new Error('The model in the link is too large');
  return JSON.parse(new TextDecoder().decode(bytes));
}
/** The address of this page carrying the project (and, for embedding, the options that strip the page down). */
export async function shareLink(p: ProjectFile, o: { embed?: boolean; layout?: 'view' | 'split' | 'canvas' } = {}): Promise<string> {
  const base = location.origin + location.pathname, q = o.embed ? `?embed=1&layout=${o.layout ?? 'view'}` : '';
  return `${base}${q}#m=${await encodeProject(p)}`;
}
export const sharedCode = (): string | null => { const m = /[#&]m=([A-Za-z0-9_-]+)/.exec(location.hash); return m ? m[1] : null; };
