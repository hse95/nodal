/**
 * The basic load combinations of ASCE/SEI 7 (Sections 2.3.1 and 2.4.1), written out for the load cases
 * that are present. "Lr or S or R" becomes one combination per roof load present, wind and earthquake are
 * taken in both directions, and combinations that only repeat another one are dropped.
 * E stands for the whole seismic load effect: the user is responsible for including the vertical part.
 */
export type Edition = '7-22' | '7-16';
export interface CaseNames { D?: string; L?: string; Lr?: string; S?: string; R?: string; W?: string; E?: string }
export interface Combination { name: string; factors: Record<string, number>; equation: string }
type Term = [keyof CaseNames, number];

export function asce7(edition: Edition, method: 'LRFD' | 'ASD', cases: CaseNames): Combination[] {
  const has = (k: keyof CaseNames) => !!cases[k] && String(cases[k]).trim() !== '';
  if (!has('D')) throw new Error('A dead load case (D) is needed');
  const e22 = edition === '7-22', roofs = (['Lr', 'S', 'R'] as const).filter(has);
  const out: Combination[] = [], seen = new Set<string>();
  const push = (eq: string, terms: Term[]) => {
    const t = terms.filter(([k, f]) => has(k) && f !== 0).map(([k, f]) => [k, Math.round(f * 1e4) / 1e4] as Term);
    const key = t.map(([k, f]) => k + f).sort().join('|'); if (seen.has(key)) return; seen.add(key);
    const factors: Record<string, number> = {}; for (const [k, f] of t) factors[String(cases[k])] = (factors[String(cases[k])] ?? 0) + f;
    const text = t.map(([k, f], i) => `${i === 0 ? (f < 0 ? '−' : '') : f < 0 ? ' − ' : ' + '}${Math.abs(f) === 1 ? '' : Math.abs(f)}${k}`).join('');
    out.push({ name: text, factors, equation: eq });
  };
  const roofOr = (fn: (r: 'Lr' | 'S' | 'R' | null) => void) => { if (roofs.length) roofs.forEach(fn); else fn(null); };
  const signs = (k: 'W' | 'E') => (has(k) ? [1, -1] : [0]);
  if (method === 'LRFD') {
    const sA = e22 ? 0.3 : 0.5, sB = e22 ? 1.0 : 1.6, sE = e22 ? 0.15 : 0.2;
    push('1', [['D', 1.4]]);
    roofOr(r => push('2', [['D', 1.2], ['L', 1.6], ...(r ? [[r, r === 'S' ? sA : 0.5] as Term] : [])]));
    roofOr(r => { if (!r) return; const rf: Term = [r, r === 'S' ? sB : 1.6]; if (has('L')) push('3', [['D', 1.2], rf, ['L', 1]]); for (const s of signs('W')) if (s) push('3', [['D', 1.2], rf, ['W', 0.5 * s]]); if (!has('L') && !has('W')) push('3', [['D', 1.2], rf]); });
    for (const s of signs('W')) if (s) roofOr(r => push('4', [['D', 1.2], ['W', s], ['L', 1], ...(r ? [[r, r === 'S' ? sA : 0.5] as Term] : [])]));
    for (const s of signs('W')) if (s) push('5', [['D', 0.9], ['W', s]]);
    for (const s of signs('E')) if (s) { push('6', [['D', 1.2], ['E', s], ['L', 1], ['S', sE]]); push('7', [['D', 0.9], ['E', s]]); }
  } else {
    const sf = e22 ? 0.7 : 1, sE = e22 ? 0.1 : 0.75;
    push('1', [['D', 1]]);
    push('2', [['D', 1], ['L', 1]]);
    roofOr(r => { if (r) push('3', [['D', 1], [r, r === 'S' ? sf : 1]]); });
    roofOr(r => push('4', [['D', 1], ['L', 0.75], ...(r ? [[r, 0.75 * (r === 'S' ? sf : 1)] as Term] : [])]));
    for (const s of signs('W')) if (s) { push('5', [['D', 1], ['W', 0.6 * s]]); roofOr(r => push('6', [['D', 1], ['L', 0.75], ['W', 0.45 * s], ...(r ? [[r, 0.75 * (r === 'S' ? sf : 1)] as Term] : [])])); push('7', [['D', 0.6], ['W', 0.6 * s]]); }
    for (const s of signs('E')) if (s) { push('8', [['D', 1], ['E', 0.7 * s]]); push('9', [['D', 1], ['E', 0.525 * s], ['L', 0.75], ['S', sE]]); push('10', [['D', 0.6], ['E', 0.7 * s]]); }
  }
  return out;
}
