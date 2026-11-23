import { describe, it, expect } from 'vitest';
import '../src/components';
import { registry } from '../src/core/graph';
import { checkW, findW, findHss, metricName, wNames } from '../src/design/steel';
import { checkBeam } from '../src/design/concrete';
import { asce7 } from '../src/design/combos';

/**
 * Benchmarks for the code checks. Steel reference values are those of the AISC Design Examples v15.0
 * and of the AISC Steel Construction Manual, 15th edition, Tables 3-2 and 4-1a (Fy = 50 ksi), which are
 * printed to three significant figures: the tolerance is 0.5 %. Concrete reference values are hand
 * calculations by the equations of ACI 318-19, written out below.
 */
const near = (got: number, ref: number, tol = 0.005) => expect(Math.abs(got - ref) / Math.abs(ref), `computed ${got}, reference ${ref}`).toBeLessThanOrEqual(tol);
const W = (n: string) => findW(n)!;

describe('AISC shapes table', () => {
  it('finds shapes by US and metric names', () => {
    expect(wNames().length).toBe(289);
    expect(W('W12x26').A).toBe(7.65); expect(W('w12X26').Ix).toBe(204);
    expect(metricName(W('W12x26'))).toBe('W310x38.7'); expect(findW('W310x38.7')!.name).toBe('W12x26'); expect(findW('W310x39')!.name).toBe('W12x26');
    expect(metricName(W('W14x132'))).toBe('W360x196'); expect(findW('W360x196')!.name).toBe('W14x132');
    expect(findW('W13x26')).toBeUndefined(); expect(findW('W310x50')).toBeUndefined();
    expect(findHss('HSS8x4x1/4')!.A).toBeGreaterThan(4);
  });
  it('is consistent: tabulated area and inertia agree with the dimensions (fillets aside)', () => {
    for (const n of wNames()) { const s = W(n), A = 2 * s.bf * s.tf + (s.d - 2 * s.tf) * s.tw, I = (s.bf * s.d ** 3 - (s.bf - s.tw) * (s.d - 2 * s.tf) ** 3) / 12; expect(A / s.A, n).toBeGreaterThan(0.93); expect(A / s.A, n).toBeLessThan(1.01); expect(I / s.Ix, n).toBeGreaterThan(0.93); expect(I / s.Ix, n).toBeLessThan(1.01); expect(Math.sqrt(s.Ix / s.A) / s.rx, n).toBeCloseTo(1, 1); }
  });
});

describe('AISC 360-16 checks against the AISC Design Examples and Manual tables', () => {
  it('D.1: W8x21 in tension, yielding of the gross section', () => { near(checkW(W('W8x21'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0 }).Pt, 277); near(checkW(W('W8x21'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0, method: 'ASD' }).Pt, 184); });
  it('E.1A: W14x132 column, Lc = 30 ft', () => { const r = checkW(W('W14x132'), { Fy: 50, Lb: 360, Lcx: 360, Lcy: 360 }); near(r.Pc, 893); expect(r.slenderInCompression).toBe(false); near(checkW(W('W14x132'), { Fy: 50, Lb: 360, Lcx: 360, Lcy: 360, method: 'ASD' }).Pc, 594); });
  it('F.1-1A and Table 3-2: W18x50, plastic moment, Lp, Lr and shear', () => {
    const r = checkW(W('W18x50'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0 });
    near(r.Mcx / 12, 379); near(r.Lp / 12, 5.83); near(r.Lr / 12, 16.9); near(r.Vc, 192); expect(r.flange).toBe('compact'); expect(r.web).toBe('compact');
    near(0.9 * 0.7 * 50 * W('W18x50').Sx / 12, 233);                                  // phi*Mr of Table 3-2
    near(checkW(W('W18x50'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0, method: 'ASD' }).Mcx / 12, 252); near(checkW(W('W18x50'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0, method: 'ASD' }).Vc, 128);
  });
  it('F.1-2A: W18x50 braced at third points (Lb = 11.67 ft, Cb = 1.01), inelastic lateral-torsional buckling', () => { const r = checkW(W('W18x50'), { Fy: 50, Lb: 11.667 * 12, Lcx: 0, Lcy: 0, Cb: 1.01 }); near(r.Mcx / 12, 305); expect(r.ltb).toBe('inelastic lateral-torsional buckling'); });
  it('F.1-3A: W18x50 braced at midspan (Lb = 17.5 ft, Cb = 1.30), elastic lateral-torsional buckling', () => { const r = checkW(W('W18x50'), { Fy: 50, Lb: 17.5 * 12, Lcx: 0, Lcy: 0, Cb: 1.30 }); near(r.Mcx / 12, 288); expect(r.ltb).toBe('elastic lateral-torsional buckling'); });
  it('Table 3-2: W12x26 and W21x44', () => { const a = checkW(W('W12x26'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0 }); near(a.Mcx / 12, 140); near(a.Lp / 12, 5.33); near(a.Lr / 12, 14.9); near(a.Vc, 84.2); const b = checkW(W('W21x44'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0 }); near(b.Mcx / 12, 358); near(b.Lp / 12, 4.45); near(b.Lr / 12, 13.0); near(b.Vc, 217); });
  it('Table 3-2: W10x12, a shape with a noncompact flange', () => { const r = checkW(W('W10x12'), { Fy: 50, Lb: 0, Lcx: 0, Lcy: 0 }); expect(r.flange).toBe('noncompact'); near(r.Mcx / 12, 46.9); expect(r.governs).toBe('compression flange local buckling'); });
  it('H.1A: W14x99 under axial compression and bending about both axes', () => {
    const r = checkW(W('W14x99'), { Fy: 50, Lb: 168, Lcx: 168, Lcy: 168, Pr: -400, Mrx: 250 * 12, Mry: 80 * 12 });
    near(r.Pc, 1130); near(r.Mcx / 12, 642); near(r.Mcy / 12, 311); near(r.ratios.combined, 0.928, 0.01); expect(r.equation).toBe('H1-1a'); expect(r.ok).toBe(true);
  });
  it('uses H1-1b for small axial force, and flags slender webs in compression', () => {
    const r = checkW(W('W18x50'), { Fy: 50, Lb: 60, Lcx: 120, Lcy: 60, Pr: -30, Mrx: 200 * 12 });
    expect(r.equation).toBe('H1-1b'); expect(r.ratios.combined).toBeCloseTo(30 / r.Pc / 2 + 2400 / r.Mcx, 10);
    expect(r.slenderInCompression).toBe(true); expect(r.Ae).toBeLessThan(W('W18x50').A); expect(r.Ae).toBeGreaterThan(0.9 * W('W18x50').A); expect(r.Pn).toBeCloseTo(r.Fcr * r.Ae, 9);
    expect(() => checkW(W('W18x50'), { Fy: 0, Lb: 0, Lcx: 0, Lcy: 0 })).toThrow();
  });
});

describe('ACI 318-19 beam checks against hand calculations', () => {
  // b = 12 in, d = 17.5 in, h = 20 in, As = 4.00 in² (4 No. 9), f'c = 4000 psi, fy = 60000 psi.
  const base = { b: 12, h: 20, d: 17.5, As: 4.0, fc: 4000, fy: 60000 };
  it('flexure: a = As fy / (0.85 f′c b), Mn = As fy (d − a/2), phi from the net tensile strain', () => {
    const r = checkBeam(base), a = 4 * 60000 / (0.85 * 4000 * 12), c = a / 0.85, eps = 0.003 * (17.5 - c) / c, phi = 0.65 + 0.25 * (eps - 60000 / 29e6) / 0.003;
    expect(a).toBeCloseTo(5.8824, 4); expect(r.a).toBeCloseTo(a, 6); expect(r.c).toBeCloseTo(c, 6); expect(r.epsT).toBeCloseTo(0.004587, 5); expect(r.region).toBe('transition');
    expect(r.Mn / 12000).toBeCloseTo(4 * 60 * (17.5 - a / 2) / 12, 4);          // 291.2 kip-ft
    expect(r.Mn / 12000).toBeCloseTo(291.18, 1); expect(r.phi).toBeCloseTo(phi, 6); expect(r.phi).toBeCloseTo(0.860, 3); expect(r.phiMn / 12000).toBeCloseTo(250.3, 0);
  });
  it('flexure: a lightly reinforced section is tension-controlled with phi = 0.9', () => { const r = checkBeam({ ...base, As: 2.0 }); expect(r.region).toBe('tension-controlled'); expect(r.phi).toBe(0.9); expect(r.phiMn / 12000).toBeCloseTo(0.9 * 2 * 60 * (17.5 - 2 * 60 / (0.85 * 4 * 12) / 2) / 12, 6); expect(r.AsMin).toBeCloseTo(200 / 60000 * 12 * 17.5, 6); });
  it('beta1 falls from 0.85 to 0.65 between 4000 and 8000 psi', () => { expect(checkBeam({ ...base, fc: 3000 }).beta1).toBe(0.85); expect(checkBeam({ ...base, fc: 5000 }).beta1).toBeCloseTo(0.80, 12); expect(checkBeam({ ...base, fc: 6000 }).beta1).toBeCloseTo(0.75, 12); expect(checkBeam({ ...base, fc: 9000 }).beta1).toBe(0.65); });
  it('shear with at least minimum stirrups: Vc = 2√f′c b d, Vs = Av fyt d / s, phi = 0.75', () => {
    const r = checkBeam({ ...base, Av: 0.22, s: 8, Vu: 30000 });                 // No. 3 stirrups at 8 in
    expect(r.Vc).toBeCloseTo(2 * Math.sqrt(4000) * 12 * 17.5, 6); expect(r.Vc / 1000).toBeCloseTo(26.56, 2); expect(r.Vs / 1000).toBeCloseTo(0.22 * 60 * 17.5 / 8, 6); expect(r.phiVn / 1000).toBeCloseTo(0.75 * (26.563 + 28.875), 2); expect(r.ratios.shear).toBeCloseTo(30 / 41.58, 3);
  });
  it('shear without stirrups: Vc = 8 λs (ρw)^(1/3) √f′c b d with the size effect factor', () => {
    const r = checkBeam({ ...base, As: 2.0 }), rho = 2 / (12 * 17.5), ls = Math.sqrt(2 / (1 + 17.5 / 10));
    expect(r.sizeEffect).toBeCloseTo(ls, 9); expect(r.Vc).toBeCloseTo(8 * ls * Math.cbrt(rho) * Math.sqrt(4000) * 12 * 17.5, 6); expect(r.Vs).toBe(0);
  });
  it('compression steel raises the strength, and the equilibrium of the section is satisfied', () => {
    const r = checkBeam({ ...base, AsPrime: 1.2, dPrime: 2.5 }), Cc = 0.85 * 4000 * r.a * 12, Cs = 1.2 * (r.fsPrime - 0.85 * 4000);
    expect(Cc + Cs).toBeCloseTo(4 * 60000, 0); expect(r.Mn).toBeGreaterThan(checkBeam(base).Mn); expect(r.epsT).toBeGreaterThan(checkBeam(base).epsT);
  });
  it('rejects impossible input and warns about over-reinforced sections', () => { expect(() => checkBeam({ ...base, d: 21 })).toThrow(); expect(checkBeam({ ...base, As: 12 }).notes.join(' ')).toMatch(/does not yield/); });
});

describe('ASCE 7 load combinations', () => {
  const names = (l: { name: string }[]) => l.map(c => c.name);
  it('7-22 strength design with D, L, S and W', () => {
    const l = names(asce7('7-22', 'LRFD', { D: 'D', L: 'L', S: 'S', W: 'W' }));
    expect(l).toEqual(['1.4D', '1.2D + 1.6L + 0.3S', '1.2D + S + L', '1.2D + S + 0.5W', '1.2D + S − 0.5W', '1.2D + W + L + 0.3S', '1.2D − W + L + 0.3S', '0.9D + W', '0.9D − W']);
  });
  it('7-16 strength design uses 0.5S and 1.6S, and 0.2S with earthquake', () => {
    const l = names(asce7('7-16', 'LRFD', { D: 'D', L: 'L', S: 'S', E: 'E' }));
    expect(l).toEqual(['1.4D', '1.2D + 1.6L + 0.5S', '1.2D + 1.6S + L', '1.2D + E + L + 0.2S', '0.9D + E', '1.2D − E + L + 0.2S', '0.9D − E']);
    expect(names(asce7('7-22', 'LRFD', { D: 'D', L: 'L', S: 'S', E: 'E' }))).toContain('1.2D + E + L + 0.15S');
  });
  it('allowable stress design, with the 0.7 factor on snow in 7-22', () => {
    expect(names(asce7('7-22', 'ASD', { D: 'D', L: 'L', S: 'S' }))).toEqual(['D', 'D + L', 'D + 0.7S', 'D + 0.75L + 0.525S']);
    expect(names(asce7('7-16', 'ASD', { D: 'D', L: 'L', Lr: 'Lr', W: 'W' }))).toEqual(['D', 'D + L', 'D + Lr', 'D + 0.75L + 0.75Lr', 'D + 0.6W', 'D + 0.75L + 0.45W + 0.75Lr', '0.6D + 0.6W', 'D − 0.6W', 'D + 0.75L − 0.45W + 0.75Lr', '0.6D − 0.6W']);
  });
  it('uses the case names given, merges cases that share a name, and needs a dead load', () => {
    const l = asce7('7-22', 'LRFD', { D: 'Dead', L: 'Live' });
    expect(l.map(c => c.factors)).toEqual([{ Dead: 1.4 }, { Dead: 1.2, Live: 1.6 }]);
    expect(() => asce7('7-22', 'LRFD', { L: 'L' })).toThrow(/dead load/);
  });
});

describe('design components', () => {
  it('are registered with units on their ports', () => { for (const id of ['fe.sec.aisc', 'fe.load.asce7', 'fe.check.aisc', 'fe.check.aci']) expect(registry.get(id), id).toBeTruthy(); expect(registry.get('fe.check.aisc')!.inputs.find(p => p.name === 'Fy')!.unit).toBe('stress'); });
});
