/**
 * Typeset mathematics. Formulas are written in TeX and drawn by KaTeX, which is
 * loaded only when the first formula is shown, so it does not slow the start of
 * the app. Until it has loaded (or if it cannot load) the formula is shown as
 * plain text.
 */
import { createMemo, createSignal, For, JSX, Show } from 'solid-js';

type Katex = { renderToString(tex: string, opt: Record<string, unknown>): string };
const [katex, setKatex] = createSignal<Katex | null>(null);
let loading = false;
function load(): void {
  if (loading) return;
  loading = true;
  Promise.all([import('katex'), import('katex/dist/katex.min.css')]).then(([m]) => setKatex(() => (m.default ?? m) as unknown as Katex)).catch(() => { /* stays as plain text */ });
}

/** Loose TeX to readable plain text, for the moment before KaTeX is ready and for places that cannot show markup. */
export function texToPlain(tex: string): string {
  let s = tex;
  for (let i = 0; i < 4; i++) s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)').replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  return s.replace(/\\(?:left|right|,|;|!|mathrm|text|operatorname)/g, '').replace(/\\cdot|\\times/g, '·').replace(/\\pi/g, 'π').replace(/\\alpha/g, 'α').replace(/\\kappa/g, 'κ').replace(/\\rho/g, 'ρ').replace(/\\Delta/g, 'Δ').replace(/\\le/g, '≤').replace(/\\ge/g, '≥').replace(/\\([a-zA-Z]+)/g, '$1').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** `big` keeps fractions at full size inside a line of text or a table cell. */
export function Tex(props: { tex: string; block?: boolean; big?: boolean }): JSX.Element {
  load();
  const html = createMemo(() => { const k = katex(); if (!k) return null; try { return k.renderToString((props.big ? '\\displaystyle ' : '') + props.tex, { throwOnError: false, displayMode: !!props.block, strict: false }); } catch { return null; } });
  return <Show when={html()} fallback={<span class="tex-plain">{texToPlain(props.tex)}</span>}><span class="tex" classList={{ block: !!props.block }} innerHTML={html()!} /></Show>;
}

/** Text in which anything between dollar signs is typeset as mathematics: "moment $\frac{wL^2}{8}$ at midspan". */
export function RichText(props: { text: string; big?: boolean }): JSX.Element {
  const parts = createMemo(() => props.text.split(/(\$[^$\n]+\$)/g).filter(Boolean));
  return <For each={parts()}>{p => (p.length > 2 && p.startsWith('$') && p.endsWith('$') ? <Tex tex={p.slice(1, -1)} big={props.big} /> : <>{p}</>)}</For>;
}
export const hasMath = (text: string): boolean => /\$[^$\n]+\$/.test(text);
