import { describe, it, expect } from 'vitest';
import katex from 'katex';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exprToTex, nameToTex, compileExpr } from '../src/core/expr';
import { typesCompatible } from '../src/core/graph';

describe('typeset form of expressions', () => {
  const cases: [string, string][] = [
    ['P*L^3/(3*E*I)', '\\frac{P\\,L^{3}}{3\\,E\\,I}'],
    ['sqrt(x^2 + y^2)', '\\sqrt{x^{2} + y^{2}}'],
    ['(a+b)^2', '\\left(a + b\\right)^{2}'],
    ['a - (b - c)', 'a - \\left(b - c\\right)'],
    ['2*3', '2\\cdot 3'],
    ['-(a+b)', '-\\left(a + b\\right)'],
    ['pi*d', '\\pi\\,d'],
    ['-P/(2*h)', '-\\frac{P}{2\\,h}'],
  ];
  for (const [src, tex] of cases) it(`${src}`, () => expect(exprToTex(src)).toBe(tex));
  it('names: Greek letters and subscripts', () => {
    expect(nameToTex('alpha')).toBe('\\alpha');
    expect(nameToTex('Iy')).toBe('I_{\\mathrm{y}}');
    expect(nameToTex('x1')).toBe('x_{1}');
    expect(nameToTex('sigma_max')).toBe('\\sigma_{\\mathrm{max}}');
    expect(nameToTex('L')).toBe('L');
  });
  it('rejects what the evaluator rejects, and every result is valid TeX', () => {
    expect(() => exprToTex('w*L^')).toThrow();
    expect(() => exprToTex('2 +* 3')).toThrow();
    for (const src of ['5*w*L^4/(384*E*I)', 'x > 0 ? x : -x', 'if(a >= b && c != 0, min(a, b), max(a, b)) % 3', 'abs(x)*exp(-k*t) + ln(y)/log10(z) + floor(q) + ceil(r)', 'atan2(y, x) + asin(s) - 1e-9*deg(t)', '2^-x + a/b/c']) {
      compileExpr(src);
      expect(() => katex.renderToString(exprToTex(src), { throwOnError: true }), src).not.toThrow();
    }
  });
});

describe('benchmark formulas', () => {
  it('every reference formula in the benchmark files is valid TeX', () => {
    const dir = join(__dirname, '../src/verify/benchmarks');
    let count = 0;
    for (const f of readdirSync(dir)) for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8')).checks) if (c.tex) { count++; expect(() => katex.renderToString(c.tex, { throwOnError: true }), `${f}: ${c.tex}`).not.toThrow(); }
    expect(count).toBeGreaterThan(50);
  });
});

describe('port type compatibility (what the editor offers when a wire is dropped)', () => {
  it('matches the conversions the engine performs', () => {
    expect(typesCompatible('number', 'integer')).toBe(true);
    expect(typesCompatible('boolean', 'number')).toBe(true);
    expect(typesCompatible('curve', 'geometry')).toBe(true);
    expect(typesCompatible('surface', 'mesh')).toBe(true);
    expect(typesCompatible('point', 'vector')).toBe(true);
    expect(typesCompatible('result', 'any')).toBe(true);
    expect(typesCompatible('number', 'text')).toBe(true);
  });
  it('refuses what cannot be converted', () => {
    expect(typesCompatible('curve', 'number')).toBe(false);
    expect(typesCompatible('result', 'model')).toBe(false);
    expect(typesCompatible('mesh', 'curve')).toBe(false);
    expect(typesCompatible('number', 'section')).toBe(false);
    expect(typesCompatible('model', 'result')).toBe(false);
  });
});

describe('icons', () => {
  it('every component has its own icon, and every icon and thumbnail is well formed', async () => {
    await import('../src/components');
    const { registry } = await import('../src/core/graph');
    const { hasIcon, iconIds, thumbIds, iconFor, thumbFor, hasThumb } = await import('../src/ui/icons');
    const missing = registry.all().filter(d => !hasIcon(d.id)).map(d => d.id);
    expect(missing).toEqual([]);
    // No two components share a drawing, and no two thumbnails are the same.
    const seen = new Map<string, string>(), twins: string[] = [];
    for (const id of iconIds()) { const k = iconFor(id), other = seen.get(k); if (other) twins.push(`${other} = ${id}`); else seen.set(k, id); }
    expect(twins).toEqual([]);
    const seenT = new Map<string, string>(), twinsT: string[] = [];
    for (const id of thumbIds()) { const k = thumbFor(id), other = seenT.get(k); if (other) twinsT.push(`${other} = ${id}`); else seenT.set(k, id); }
    expect(twinsT).toEqual([]);
    for (const id of iconIds()) expect(iconFor(id), id).toMatch(/^(<(path|circle|rect|text)[^>]*(\/>|>[^<]*<\/text>))+$/);
    for (const id of thumbIds()) expect(thumbFor(id), id).toMatch(/^(<(path|circle|rect|text)[^>]*(\/>|>[^<]*<\/text>))+$/);
    const { TEMPLATES } = await import('../src/templates');
    const { EXAMPLES } = await import('../src/examples');
    const { BENCHMARKS } = await import('../src/verify/load');
    expect(TEMPLATES.filter(t => !hasThumb(t.id)).map(t => t.id)).toEqual([]);
    expect(EXAMPLES.filter(e => !e.id.startsWith('bench-') && !hasThumb(e.id)).map(e => e.id)).toEqual([]);
    expect(BENCHMARKS.filter(b => !hasThumb('b:' + b.builder)).map(b => b.builder)).toEqual([]);
  });
});
