import { For, JSX, Show, createSignal, onCleanup } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import { project, mutate, settled, engine, beginUndoGroup, endUndoGroup, undoDepth, undoTo, setAiTouched, toast } from './store';
import { runTurn } from '../ai/agent';
import type { Block, ImageBlock, Message, Usage } from '../ai/client';
import type { GraphHost } from '../ai/tools';
import { MODELS, forgetKey, loadKey, loadModel, redact, saveKey, saveModel } from '../ai/key';
import { MdBlock, parseMarkdown } from '../ai/markdown';

interface Shown { role: 'user' | 'assistant'; text: string; images: string[]; actions: { line: string; ok: boolean }[]; usage?: Usage; note?: string; error?: string; undoTo?: number; undone?: boolean; busy?: boolean }

/** The editor's own command layer, as the assistant's tools see it. */
const host: GraphHost = { project: () => unwrap(project), mutate: fn => mutate(fn), settle: settled, engine };

const MAX_SIDE = 1568, TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Read an image file and scale it down in the browser so its longest side is at most 1568 px. */
async function readImage(file: File): Promise<{ block: ImageBlock; url: string }> {
  if (!TYPES.includes(file.type)) throw new Error('Only PNG, JPEG, WebP and GIF images can be attached.');
  const bitmap = await createImageBitmap(file), k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  let type = file.type, url: string;
  if (k === 1 && file.size < 3_500_000) url = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('The image could not be read.')); r.readAsDataURL(file); });
  else {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bitmap.width * k)); c.height = Math.max(1, Math.round(bitmap.height * k));
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
    type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'; url = c.toDataURL(type, 0.9);
  }
  bitmap.close?.();
  return { url, block: { type: 'image', source: { type: 'base64', media_type: type, data: url.slice(url.indexOf(',') + 1) } } };
}

/** Model text drawn with text nodes only: nothing in it can become markup. */
function Markdown(props: { text: string }): JSX.Element {
  const spans = (b: MdBlock) => <For each={b.spans}>{s => s.t === 'bold' ? <b>{s.s}</b> : s.t === 'code' ? <code>{s.s}</code> : <>{s.s}</>}</For>;
  return <div class="md"><For each={parseMarkdown(props.text)}>{b =>
    b.k === 'pre' ? <pre>{b.spans[0].s}</pre> : b.k === 'li' ? <div class="li"><span>•</span><div>{spans(b)}</div></div> : b.k === 'oli' ? <div class="li"><span>–</span><div>{spans(b)}</div></div> : b.k === 'h' ? <p><b>{spans(b)}</b></p> : <p>{spans(b)}</p>}</For></div>;
}

export default function Assistant(): JSX.Element {
  const saved = loadKey();
  const [key, setKey] = createSignal(saved.key), [remember, setRemember] = createSignal(saved.remembered), [model, setModel] = createSignal(loadModel());
  const [settings, setSettings] = createSignal(!saved.key), [draft, setDraft] = createSignal(''), [busy, setBusy] = createSignal(false), [status, setStatus] = createSignal(''), [over, setOver] = createSignal(false);
  const [pending, setPending] = createSignal<{ block: ImageBlock; url: string }[]>([]);
  const [shown, setShown] = createStore<Shown[]>([]);
  let history: Message[] = [], abort: AbortController | null = null, list!: HTMLDivElement, input!: HTMLTextAreaElement, fadeTimer = 0;
  onCleanup(() => { abort?.abort(); clearTimeout(fadeTimer); });
  const scroll = () => requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
  const applyKey = (k: string, r: boolean) => { setKey(k.trim()); setRemember(r); saveKey(k, r); };

  const attach = async (files: Iterable<File>) => {
    for (const f of files) {
      if (pending().length >= 4) { toast('At most four images per message.'); break; }
      try { const img = await readImage(f); setPending(p => [...p, img]); } catch (e) { toast((e as Error).message); }
    }
  };
  const newChat = () => { abort?.abort(); history = []; setShown([]); setPending([]); setStatus(''); input?.focus(); };

  const sendMessage = async () => {
    const text = draft().trim(), images = pending();
    if (busy() || (!text && !images.length)) return;
    if (!key()) { setSettings(true); return; }
    setDraft(''); setPending([]); setBusy(true); setStatus('');
    const user: Block[] = [...images.map(i => i.block), { type: 'text', text: text || 'Build what the image shows.' }];
    setShown(produce(s => { s.push({ role: 'user', text, images: images.map(i => i.url), actions: [] }); s.push({ role: 'assistant', text: '', images: [], actions: [], busy: true }); }));
    const at = shown.length - 1, depth = undoDepth(), touched = new Set<string>();
    scroll();
    abort = new AbortController();
    clearTimeout(fadeTimer);
    const r = await runTurn({
      key: key(), model: model(), host, history, user, signal: abort.signal, beginGroup: beginUndoGroup, endGroup: endUndoGroup,
      events: {
        onText: d => { setShown(at, 'text', t => t + d); scroll(); },
        onAction: (line, ok) => { setShown(at, 'actions', a => [...a, { line, ok }]); scroll(); },
        onTouched: ids => { ids.forEach(id => touched.add(id)); setAiTouched(new Set(touched)); },
        onStatus: setStatus, onUsage: u => setShown(at, 'usage', u),
      },
    });
    history = r.messages;
    setShown(at, produce(m => {
      m.busy = false; m.usage = r.usage;
      if (r.changed && undoDepth() > depth) m.undoTo = depth;
      if (r.error) m.error = redact(r.error);
      if (r.stopped === 'cancelled') m.note = 'Stopped.';
      if (r.stopped === 'limit') m.note = 'Stopped: the limit of steps for one turn was reached. Send "continue" to go on.';
    }));
    setBusy(false); setStatus(''); abort = null;
    if (r.changed) window.dispatchEvent(new CustomEvent('nodal:fit'));          // bring what was built into view
    fadeTimer = window.setTimeout(() => setAiTouched(new Set<string>()), 4000);
    scroll();
  };
  const undoTurn = (i: number) => { const d = shown[i].undoTo; if (d === undefined) return; undoTo(d); setShown(i, produce(m => { m.undone = true; m.undoTo = undefined; })); setAiTouched(new Set<string>()); history.push({ role: 'user', content: [{ type: 'text', text: '(The user undid the changes of your last turn. Call get_graph before editing again.)' }] }, { role: 'assistant', content: [{ type: 'text', text: 'Understood.' }] }); };
  const usageLine = (u: Usage) => `${(u.input + u.cacheRead + u.cacheWrite).toLocaleString()} tokens in${u.cacheRead ? ` (${u.cacheRead.toLocaleString()} from cache)` : ''}, ${u.output.toLocaleString()} out`;

  return <div class="assistant" classList={{ over: over() }}
    onDragOver={e => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files.length) void attach(e.dataTransfer.files); }}>
    <div class="as-head">
      <span class="muted">Optional · your own key</span><span class="grow" />
      <button class="link" onClick={newChat} title="Start a new conversation">New chat</button>
      <button class="link" classList={{ on: settings() }} onClick={() => setSettings(!settings())} aria-expanded={settings()}>Settings</button>
    </div>
    <Show when={settings()}>
      <div class="as-settings" aria-label="AI assistant settings">
        <label>Anthropic API key<input type="password" autocomplete="off" spellcheck={false} placeholder="sk-ant-…" value={key()} onInput={e => applyKey(e.currentTarget.value, remember())} aria-label="Anthropic API key" /></label>
        <label>Model<select value={model()} onChange={e => { setModel(e.currentTarget.value); saveModel(e.currentTarget.value); }} aria-label="Model"><For each={MODELS}>{m => <option value={m.id}>{m.name} ({m.note})</option>}</For></select></label>
        <label class="check"><input type="checkbox" checked={remember()} onChange={e => applyKey(key(), e.currentTarget.checked)} /> Remember key on this device</label>
        <div class="row"><button onClick={() => { forgetKey(); setKey(''); setRemember(false); }}>Forget key</button><a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer">Get a key at console.anthropic.com</a></div>
        <p class="muted">Your messages, images and the current model are sent to Anthropic using your own API key. Usage is billed to your Anthropic account. Without a key, Nodal never contacts Anthropic. {remember() ? 'The key is stored in this browser until you press Forget key.' : 'The key is kept only until you close this tab.'}</p>
      </div>
    </Show>
    <div class="as-list" ref={list} aria-live="polite">
      <Show when={!shown.length}>
        <div class="as-empty">
          <p>Describe a structure, or paste a sketch or a photo of a problem, and the assistant builds it from ordinary components that you can then edit.</p>
          <For each={['Simply supported steel beam, 6 m span, 20 kN/m uniform load. Show moment and deflection.', 'Cantilever, 3 m, 10 kN at the tip.', 'Portal frame 8 m wide and 4 m high, fixed bases, 15 kN sideways at the eave.']}>{t => <button class="as-hint" onClick={() => { setDraft(t); input.focus(); }}>{t}</button>}</For>
          <p class="muted">The assistant builds the model. Every result comes from Nodal's solver. Check models and results before relying on them.</p>
        </div>
      </Show>
      <For each={shown}>{(m, i) => <div class="as-msg" classList={{ user: m.role === 'user' }}>
        <Show when={m.images.length}><div class="as-imgs"><For each={m.images}>{u => <img src={u} alt="Attached image" />}</For></div></Show>
        <Show when={m.role === 'user'} fallback={<Markdown text={m.text} />}><p class="as-user">{m.text}</p></Show>
        <Show when={m.actions.length}>
          <details class="as-actions"><summary>{m.actions.filter(a => a.ok).length} action{m.actions.filter(a => a.ok).length === 1 ? '' : 's'}{m.actions.some(a => !a.ok) ? `, ${m.actions.filter(a => !a.ok).length} corrected` : ''}: {m.actions.filter(a => a.ok).slice(0, 3).map(a => a.line).join(', ')}{m.actions.length > 3 ? ' …' : ''}</summary>
            <For each={m.actions}>{a => <div classList={{ bad: !a.ok }}>{a.line}</div>}</For></details>
        </Show>
        <Show when={m.busy && !m.text && !m.actions.length}><p class="muted">Thinking…</p></Show>
        <Show when={m.error}><p class="as-error" role="alert">{m.error}</p></Show>
        <Show when={m.note}><p class="muted">{m.note}</p></Show>
        <Show when={m.undoTo !== undefined}><button class="as-undo" disabled={busy()} onClick={() => undoTurn(i())}>Undo AI changes</button></Show>
        <Show when={m.undone}><p class="muted">Changes undone.</p></Show>
        <Show when={m.usage && !m.busy && (m.usage.input || m.usage.output)}><p class="as-usage">{usageLine(m.usage!)}</p></Show>
      </div>}</For>
      <Show when={status()}><p class="muted pad">{status()}</p></Show>
    </div>
    <Show when={pending().length}><div class="as-imgs pending"><For each={pending()}>{(p, i) => <span><img src={p.url} alt="Image to send" /><button aria-label="Remove image" onClick={() => setPending(l => l.filter((_, j) => j !== i()))}>×</button></span>}</For></div></Show>
    <div class="as-input">
      <textarea ref={input} rows={2} placeholder={key() ? 'Describe a model, or paste an image…' : 'Enter an API key in Settings to start'} value={draft()} aria-label="Message to the assistant"
        onInput={e => setDraft(e.currentTarget.value)}
        onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void sendMessage(); } }}
        onPaste={e => { const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/')); if (files.length) { e.preventDefault(); void attach(files); } }} />
      <div class="row">
        <label class="as-attach" title="Attach an image (or paste or drop one)"><input type="file" accept={TYPES.join(',')} multiple hidden onChange={e => { if (e.currentTarget.files) void attach(e.currentTarget.files); e.currentTarget.value = ''; }} /><svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M4.5 6.5h15v11h-15zM4.5 15l4.5-4 3.5 3 2.5-2 4.5 4" /><circle cx="15.5" cy="10" r="1.2" /></svg><span class="sr">Attach image</span></label>
        <span class="grow" />
        <Show when={busy()} fallback={<button class="primary" disabled={!draft().trim() && !pending().length} onClick={() => void sendMessage()}>Send</button>}><button class="stop" onClick={() => abort?.abort()}>Stop</button></Show>
      </div>
    </div>
    <Show when={over()}><div class="as-drop">Drop an image to attach it</div></Show>
  </div>;
}
