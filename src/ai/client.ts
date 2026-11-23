/**
 * A small client for the Anthropic Messages API, called straight from the browser with the user's own
 * key. Plain fetch with streaming; no SDK. The key is passed in by the caller and is never logged,
 * stored or put in an error message here.
 */
export interface ImageBlock { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export interface TextBlock { type: 'text'; text: string }
export interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;
export interface Message { role: 'user' | 'assistant'; content: Block[] }
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface Reply { content: (TextBlock | ToolUseBlock)[]; stop: string; usage: Usage }
export interface Request { key: string; model: string; system: string; messages: Message[]; tools: unknown[]; maxTokens?: number; signal?: AbortSignal; onText?: (delta: string) => void; onStatus?: (text: string) => void }

export const API_URL = 'https://api.anthropic.com/v1/messages';
export class ApiError extends Error { constructor(message: string, readonly kind: 'key' | 'busy' | 'network' | 'cancelled' | 'request' | 'server') { super(message); } }

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ApiError('Stopped.', 'cancelled')); }, { once: true });
});
/** Delays between attempts when the service is busy (overridden in tests). */
export const retry = { delays: [1500, 4000, 9000] };

export async function send(req: Request): Promise<Reply> {
  const body = JSON.stringify({
    model: req.model, max_tokens: req.maxTokens ?? 8000, stream: true,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    tools: req.tools, messages: req.messages,
  });
  for (let attempt = 0; ; attempt++) {
    if (req.signal?.aborted) throw new ApiError('Stopped.', 'cancelled');
    let res: Response;
    try {
      res = await fetch(API_URL, {
        method: 'POST', body, signal: req.signal,
        headers: { 'x-api-key': req.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
    } catch (e) {
      if (req.signal?.aborted || (e as Error)?.name === 'AbortError') throw new ApiError('Stopped.', 'cancelled');
      throw new ApiError('Could not reach Anthropic. Check your internet connection and try again.', 'network');
    }
    if (res.ok && res.body) return readStream(res.body, req);
    const detail = await errorText(res);
    if (res.status === 401 || res.status === 403) throw new ApiError('Anthropic did not accept the API key. Check the key in the assistant settings.', 'key');
    if (res.status === 429 || res.status === 529 || res.status === 503) {
      if (attempt < retry.delays.length) {
        const after = Number(res.headers.get('retry-after')), wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 30000) : retry.delays[attempt];
        req.onStatus?.(res.status === 429 ? `Rate limit reached; trying again in ${Math.round(wait / 1000)} s…` : `Anthropic is busy; trying again in ${Math.round(wait / 1000)} s…`);
        await sleep(wait, req.signal);
        req.onStatus?.('');
        continue;
      }
      throw new ApiError(res.status === 429 ? 'The rate limit of your Anthropic account was reached. Wait a little and try again.' : 'Anthropic is overloaded at the moment. Try again shortly.', 'busy');
    }
    if (res.status >= 500) throw new ApiError('Anthropic reported a server error. Try again shortly.', 'server');
    throw new ApiError(`Anthropic rejected the request (${res.status})${detail ? ': ' + detail : '.'}`, 'request');
  }
}
async function errorText(res: Response): Promise<string> {
  try { const j = JSON.parse(await res.text()); const m = j?.error?.message; return typeof m === 'string' ? m.slice(0, 300) : ''; } catch { return ''; }
}

/** Read the server-sent events of a streamed reply into content blocks. */
async function readStream(stream: ReadableStream<Uint8Array>, req: Request): Promise<Reply> {
  const reader = stream.getReader(), dec = new TextDecoder();
  const blocks: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; json: string })[] = [];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let stop = '', buf = '';
  const handle = (data: string) => {
    let ev: any; try { ev = JSON.parse(data); } catch { return; }
    switch (ev.type) {
      case 'message_start': { const u = ev.message?.usage ?? {}; usage.input = u.input_tokens ?? 0; usage.cacheRead = u.cache_read_input_tokens ?? 0; usage.cacheWrite = u.cache_creation_input_tokens ?? 0; usage.output = u.output_tokens ?? 0; break; }
      case 'content_block_start': { const b = ev.content_block ?? {}; blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: String(b.id), name: String(b.name), json: '' } : { type: 'text', text: typeof b.text === 'string' ? b.text : '' }; break; }
      case 'content_block_delta': { const b = blocks[ev.index], d = ev.delta ?? {}; if (!b) break; if (b.type === 'text' && d.type === 'text_delta') { b.text += d.text; req.onText?.(d.text); } else if (b.type === 'tool_use' && d.type === 'input_json_delta') b.json += d.partial_json ?? ''; break; }
      case 'message_delta': { if (ev.delta?.stop_reason) stop = ev.delta.stop_reason; if (ev.usage?.output_tokens !== undefined) usage.output = ev.usage.output_tokens; break; }
      case 'error': throw new ApiError(ev.error?.type === 'overloaded_error' ? 'Anthropic is overloaded at the moment. Try again shortly.' : 'Anthropic reported an error while replying. Try again.', ev.error?.type === 'overloaded_error' ? 'busy' : 'server');
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); if (line.startsWith('data:')) handle(line.slice(5).trim()); }
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (req.signal?.aborted || (e as Error)?.name === 'AbortError') throw new ApiError('Stopped.', 'cancelled');
    throw new ApiError('The connection to Anthropic was interrupted. Try again.', 'network');
  }
  const content = blocks.filter(Boolean).map(b => {
    if (b.type === 'text') return { type: 'text' as const, text: b.text };
    let input: unknown = {}; try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = { __invalid_json: true }; }
    return { type: 'tool_use' as const, id: b.id, name: b.name, input };
  }).filter(b => b.type !== 'text' || b.text.length > 0);
  return { content, stop, usage };
}
