/**
 * Where the user's Anthropic API key lives. By default it is kept for the browser session only
 * (sessionStorage, with a plain variable as a fallback). Only when the user ticks "Remember key on this
 * device" is it written to localStorage. It is never part of a project file, a link or a log.
 */
export const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'default; good balance of cost and ability' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'fastest and cheapest' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'more capable, costs more' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', note: 'most capable, costs most' },
] as const;
export const DEFAULT_MODEL = MODELS[0].id;
const KEY = 'nodal.ai.key', MODEL = 'nodal.ai.model';
let memory = '';
const store = (kind: 'local' | 'session'): Storage | null => { try { return kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage; } catch { return null; } };

export function loadKey(): { key: string; remembered: boolean } {
  const saved = store('local')?.getItem(KEY);
  if (saved) return { key: saved, remembered: true };
  return { key: store('session')?.getItem(KEY) ?? memory, remembered: false };
}
export function saveKey(key: string, remember: boolean): void {
  const k = key.trim();
  memory = k;
  const local = store('local'), session = store('session');
  try { if (remember && k) local?.setItem(KEY, k); else local?.removeItem(KEY); } catch { /* storage unavailable */ }
  try { if (!remember && k) session?.setItem(KEY, k); else session?.removeItem(KEY); } catch { /* storage unavailable */ }
}
export function forgetKey(): void { memory = ''; try { store('local')?.removeItem(KEY); } catch { /* ignore */ } try { store('session')?.removeItem(KEY); } catch { /* ignore */ } }
export function loadModel(): string { const m = store('local')?.getItem(MODEL); return MODELS.some(x => x.id === m) ? m! : DEFAULT_MODEL; }
export function saveModel(id: string): void { if (MODELS.some(x => x.id === id)) try { store('local')?.setItem(MODEL, id); } catch { /* ignore */ } }
/** Remove anything that looks like an Anthropic key from text before it is shown or logged. */
export const redact = (text: string): string => text.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-…');
