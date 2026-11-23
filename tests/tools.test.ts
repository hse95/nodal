import { describe, it, expect } from 'vitest';
import '../src/components';
import { Engine, registry } from '../src/core/graph';
import { ALIASES } from '../src/core/aliases';
import { TEMPLATES } from '../src/templates';
import { EXAMPLES } from '../src/examples';
import { teach, teachable } from '../src/teach/steps';
import { Pdf, latin, textWidth } from '../src/io/pdf';
import { verificationPdf } from '../src/verify/report';
import { BENCHMARKS } from '../src/verify/load';
import { runBenchmark } from '../src/verify/runner';
import type { FEResult } from '../src/fe/system';

async function resultOf(project: any): Promise<FEResult> {
  const e = new Engine(); await e.run(project);
  for (const n of project.graph.nodes) for (const t of e.outputs(n.id)) { const r = t?.first?.() as any; if (r && r.k === 'result' && r.kind === 'static') return r; }
  throw new Error('no static result');
}
const sym = (K: number[][]) => Math.max(...K.flatMap((r, i) => r.map((x, j) => Math.abs(x - K[j][i])))) / Math.max(...K.flat().map(Math.abs));

describe('stiffness method, step by step', () => {
  it('cantilever template: three unknowns per node, and the same answer as the solver', async () => {
    const r = await resultOf(TEMPLATES.find(t => t.id === 'beam-cantilever')!.build().project), t = teach(r);
    expect(teachable(r.model)).toBeNull(); expect(t.plane).toBe(true); expect(t.per).toEqual([0, 2, 4]);
    expect(t.labels.length).toBe(3 * t.nodes.length); expect(t.K.length).toBe(t.labels.length); expect(sym(t.K)).toBeLessThan(1e-12);
    expect(t.free.length).toBe(t.labels.length - 3); expect(t.agreement).toBeLessThan(1e-9);
    // Tip deflection PL³/3EI and the fixed-end reactions P and PL (10 kN at 3 m), from the written-out solution.
    const tip = t.u[t.labels.indexOf(`uz${t.nodes.length}`)], EI = 210e9 * (150 * 300 ** 3 - (150 - 7.1) * (300 - 2 * 10.7) ** 3) / 12 * 1e-12;
    expect(Math.abs(Math.abs(tip) / (10e3 * 27 / (3 * EI)) - 1)).toBeLessThan(0.02);        // exact without shear deformation, a little more with it
    expect(t.reactions[t.labels.indexOf('uz1')]).toBeCloseTo(10e3, 3); expect(Math.abs(t.reactions[t.labels.indexOf('ry1')])).toBeCloseTo(30e3, 2);
    const e = t.elements[0]; expect(e.kLocal.length).toBe(6); expect(e.kGlobal.length).toBe(6); expect(e.T.length).toBe(6); expect(e.T[0].length).toBe(6); expect(sym(e.kGlobal)).toBeLessThan(1e-12);
    expect(e.kLocal[0][0]).toBeCloseTo(r.model.materials[0].E * r.model.sections[0].A / e.L, 3);
  });
  it('a plane truss needs two unknowns per node and 2 × 2 member matrices in local axes', async () => {
    const r = await resultOf(EXAMPLES.find(x => x.id === 'quick-truss')!.build().project), t = teach(r);
    expect(t.per).toEqual([0, 2]); expect(t.elements.every(e => e.kLocal.length === 2 && e.kGlobal.length === 4 && e.T.length === 2 && e.T[0].length === 4)).toBe(true);
    expect(t.agreement).toBeLessThan(1e-9);
    const e = t.elements[0], c = e.T[0][0], s = e.T[0][1], k = e.kLocal[0][0];
    expect(c * c + s * s).toBeCloseTo(1, 12); expect(e.kGlobal[0][0]).toBeCloseTo(k * c * c, 6); expect(e.kGlobal[0][1]).toBeCloseTo(k * c * s, 6); expect(e.kGlobal[0][2]).toBeCloseTo(-k * c * c, 6);
    // Assembly: each diagonal term of K is the sum of the member terms that meet there.
    const i = e.dofs[0]; expect(t.K[i][i]).toBeCloseTo(t.elements.filter(x => x.dofs.includes(i)).reduce((sum, x) => sum + x.kGlobal[x.dofs.indexOf(i)][x.dofs.indexOf(i)], 0), 3);
  });
  it('portal frame template agrees with the solver; large and shell models are declined with a reason', async () => {
    const r = await resultOf(TEMPLATES.find(t => t.id === 'frame-portal')!.build().project);
    if (!teachable(r.model)) expect(teach(r).agreement).toBeLessThan(1e-9); else expect(teachable(r.model)).toMatch(/small models/);
    expect(teachable((await resultOf(EXAMPLES.find(x => x.id === 'portal-building')!.build().project)).model)).toMatch(/small models/);
    expect(teachable((await resultOf(TEMPLATES.find(t => t.id === 'plate')!.build().project)).model)).toMatch(/shell/);
  });
});

describe('PDF writer and verification report', () => {
  it('writes a well-formed PDF with the right number of pages', () => {
    const pdf = new Pdf(); pdf.paragraph('Title', { size: 18, bold: true }); pdf.table(['A', 'B'], Array.from({ length: 120 }, (_, i) => [`row ${i}`, String(i * 1.5)]), [0.7, 0.3], { align: ['left', 'right'] });
    const bytes = pdf.build({ title: 'Test (1)' }), text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true); expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = Number(/\/Count (\d+)/.exec(text)![1]); expect(pages).toBeGreaterThan(1); expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(pages);
    // The cross-reference table points at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)![1]); expect(text.slice(xref, xref + 4)).toBe('xref');
    const offs = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n /gm)].map(m => Number(m[1])); offs.forEach((o, i) => expect(text.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    expect(text).toContain('(Test \\(1\\))'); expect(text).toContain('(row 119)');
  });
  it('keeps text within the built-in font: symbols are written plainly', () => { expect(latin('δ ≤ wL⁴/384EI — 5 kN·m²')).toBe('delta <= wL^4/384EI - 5 kN·m²'); expect(latin('日本')).toBe('??'); expect(textWidth('WWWW', 10)).toBeGreaterThan(textWidth('iiii', 10)); });
  it('the verification report lists every benchmark and its outcome', () => {
    const results = BENCHMARKS.slice(0, 6).map(b => runBenchmark(b)), text = Buffer.from(verificationPdf(results, { version: '9.9.9', date: '2026-11-22', browser: 'test' })).toString('latin1');
    expect(text).toContain('Nodal verification report'); expect(text).toContain('Version 9.9.9'); expect(text).toContain(`${results.filter(r => r.pass).length} of 6 benchmarks pass`);
    for (const r of results) expect(text).toContain(latin(`${r.def.id} ${r.def.title}`).replace(/([\\()])/g, '\\$1').slice(0, 30));
    expect((text.match(/\(PASS\)/g) ?? []).length).toBe(results.filter(r => r.pass).length + results.flatMap(r => r.rows).filter(c => c.pass).length);
  });
});

describe('names familiar from Grasshopper', () => {
  it('every alias points at a real component', () => {
    const names = new Set(registry.all().map(d => d.name));
    expect(Object.keys(ALIASES).filter(n => !names.has(n))).toEqual([]);
    expect(Object.keys(ALIASES).length).toBeGreaterThan(60);
  });
});
