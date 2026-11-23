/**
 * Model text is untrusted. It is split into plain tokens here and drawn with text nodes only, so
 * nothing the model writes can become markup. Supported: paragraphs, bullet and numbered lists,
 * **bold**, `code` and fenced code blocks.
 */
export type Span = { t: 'text' | 'bold' | 'code'; s: string };
export type MdBlock = { k: 'p' | 'li' | 'oli' | 'h' | 'pre'; spans: Span[] };

export function inline(text: string): Span[] {
  const out: Span[] = [], re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
    out.push(m[2] !== undefined ? { t: 'bold', s: m[2] } : { t: 'code', s: m[3] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}
export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = [], lines = text.replace(/\r/g, '').split('\n');
  let para: string[] = [], code: string[] | null = null;
  const flush = () => { if (para.length) { blocks.push({ k: 'p', spans: inline(para.join(' ')) }); para = []; } };
  for (const line of lines) {
    if (/^```/.test(line.trim())) { if (code) { blocks.push({ k: 'pre', spans: [{ t: 'code', s: code.join('\n') }] }); code = null; } else { flush(); code = []; } continue; }
    if (code) { code.push(line); continue; }
    const li = /^\s*[-*•]\s+(.*)$/.exec(line), oli = /^\s*\d+[.)]\s+(.*)$/.exec(line), h = /^\s*#{1,4}\s+(.*)$/.exec(line);
    if (li) { flush(); blocks.push({ k: 'li', spans: inline(li[1]) }); }
    else if (oli) { flush(); blocks.push({ k: 'oli', spans: inline(oli[1]) }); }
    else if (h) { flush(); blocks.push({ k: 'h', spans: inline(h[1]) }); }
    else if (!line.trim()) flush();
    else para.push(line.trim());
  }
  if (code) blocks.push({ k: 'pre', spans: [{ t: 'code', s: code.join('\n') }] });
  flush();
  return blocks;
}
