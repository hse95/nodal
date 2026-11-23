/**
 * One assistant turn: send the conversation, run the tools the model asks for, send the results back,
 * and repeat until the model stops asking. All canvas changes of a turn are one undo step.
 */
import { ApiError, Block, Message, Reply, Request, ToolResultBlock, ToolUseBlock, Usage, send } from './client';
import { GraphHost, TOOL_DEFS, executeTool } from './tools';
import { buildSystemPrompt } from './catalogue';

/** Limits for one user turn: round trips to the model, and tool calls in total. */
export const LIMITS = { rounds: 25, calls: 150 };
export interface TurnEvents {
  onText?(delta: string): void;
  onAction?(line: string, ok: boolean): void;
  onTouched?(ids: string[]): void;
  onStatus?(text: string): void;
  onUsage?(u: Usage): void;
}
export interface TurnResult { messages: Message[]; text: string; actions: { line: string; ok: boolean }[]; touched: string[]; usage: Usage; stopped?: 'limit' | 'cancelled'; error?: string; changed: boolean }
export interface TurnOptions { key: string; model: string; host: GraphHost; history: Message[]; user: Block[]; signal?: AbortSignal; events?: TurnEvents; beginGroup?(): void; endGroup?(): void; transport?: (req: Request) => Promise<Reply> }

export async function runTurn(o: TurnOptions): Promise<TurnResult> {
  const messages: Message[] = [...o.history, { role: 'user', content: o.user }];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, actions: { line: string; ok: boolean }[] = [], touched = new Set<string>();
  const system = buildSystemPrompt(o.host.project().units), call = o.transport ?? send;
  let text = '', calls = 0, changed = false, stopped: TurnResult['stopped'], error: string | undefined;
  o.beginGroup?.();
  try {
    for (let round = 0; ; round++) {
      if (round >= LIMITS.rounds || calls >= LIMITS.calls) { stopped = 'limit'; break; }
      const reply = await call({ key: o.key, model: o.model, system, messages, tools: TOOL_DEFS, signal: o.signal, onText: d => { text += d; o.events?.onText?.(d); }, onStatus: o.events?.onStatus });
      usage.input += reply.usage.input; usage.output += reply.usage.output; usage.cacheRead += reply.usage.cacheRead; usage.cacheWrite += reply.usage.cacheWrite;
      o.events?.onUsage?.({ ...usage });
      messages.push({ role: 'assistant', content: reply.content });
      const uses = reply.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (!uses.length) break;
      if (text && !text.endsWith('\n')) { text += '\n\n'; o.events?.onText?.('\n\n'); }
      const results: ToolResultBlock[] = [];
      for (const u of uses) {
        if (o.signal?.aborted) throw new ApiError('Stopped.', 'cancelled');
        if (calls >= LIMITS.calls) { results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ error: 'The limit of tool calls for one turn was reached.' }), is_error: true }); continue; }
        calls++;
        const out = (u.input as any)?.__invalid_json ? { result: { error: 'The tool input was not valid JSON.' } } : await executeTool(o.host, u.name, u.input);
        const failed = 'error' in out.result;
        if (out.action || failed) { const line = out.action ?? `${u.name}: ${String(out.result.error)}`; actions.push({ line, ok: !failed }); o.events?.onAction?.(line, !failed); }
        if (out.touched?.length) { out.touched.forEach(id => touched.add(id)); o.events?.onTouched?.(out.touched); }
        if (out.action && !failed && !/^run analysis/.test(out.action)) changed = true;
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result), ...(failed ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (e) {
    if (e instanceof ApiError && e.kind === 'cancelled') stopped = 'cancelled';
    else error = e instanceof ApiError ? e.message : 'Something went wrong while talking to Anthropic.';
    // A conversation must not end on an assistant message whose tool calls have no results.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && last.content.some(b => b.type === 'tool_use')) messages.push({ role: 'user', content: last.content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map(b => ({ type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify({ error: 'Not run: the turn was stopped.' }), is_error: true })) });
  } finally { o.endGroup?.(); }
  if (stopped === 'limit') { const last = messages[messages.length - 1]; if (last?.role === 'user') messages.push({ role: 'assistant', content: [{ type: 'text', text: '(Stopped: the limit of steps for one turn was reached.)' }] }); }
  return { messages, text, actions, touched: [...touched], usage, stopped, error, changed };
}
