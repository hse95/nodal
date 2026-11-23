/**
 * Component library, part 5: design aids. AISC shapes, ASCE 7 load combinations, and member checks to
 * AISC 360 and ACI 318. A check component reports strengths and ratios; it does not design the member.
 */
import { P } from '../core/graph';
import type { SolveContext, TableValue } from '../core/types';
import { C, num, int } from './basic';
import * as fm from '../fe/model';
import { combo } from '../fe/parts';
import { unitSystem, UnitSystem } from '../fe/units';
import { checkW, findHss, findW, metricName, WShape } from '../design/steel';
import { checkBeam } from '../design/concrete';
import { asce7, Edition } from '../design/combos';

const U = (ctx: SolveContext): UnitSystem => unitSystem(ctx.units);
const txt = (n: string, d: string, def?: string, o: any = {}) => P(n, 'text', d, { d: def, ...o });
const IN = 0.0254, KIP = 4448.2216152605, KSI = 6894757.2931783, KIPIN = KIP * IN;
const g4 = (x: number) => (Math.abs(x) >= 1000 ? x.toFixed(0) : Number(x.toPrecision(4)).toString());

/** A section for analysis from a W shape: the tabulated properties, with the I outline for drawing. */
export function wSection(s: WShape): fm.Section {
  const base = fm.secI(s.d * IN, s.bf * IN, s.tw * IN, s.tf * IN);
  return { ...base, name: s.name, A: s.A * IN ** 2, Iy: s.Ix * IN ** 4, Iz: s.Iy * IN ** 4, J: s.J * IN ** 4, Asz: s.d * s.tw * IN ** 2, Asy: 5 / 3 * s.bf * s.tf * IN ** 2, aisc: s } as fm.Section;
}
C('fe.sec.aisc', 'AISC Shape', 'AISC', 'Structure', 'A wide-flange (W) or rectangular HSS section from the AISC shapes table, by name: W12x26, the metric name W310x38.7, or HSS8x4x1/4. The tabulated area, moments of inertia and torsion constant are used.',
  [txt('Name', 'Shape name, for example W12x26, W310x39 or HSS8x4x1/4', 'W12x26', { nick: 'N' })],
  [P('Section', 'section', 'The cross-section', { nick: 'S' }), txt('Label', 'US and metric names', undefined, { nick: 'L' }), num('Weight', 'Weight per unit length', undefined, { nick: 'w', u: 'lineLoad' }), num('Zx', 'Plastic modulus about the strong axis', undefined, { nick: 'Zx' })],
  ([name], ctx) => {
    const u = U(ctx), w = findW(String(name));
    if (w) return [wSection(w), `${w.name} (${metricName(w)})`, w.W * 4.4482216152605 / 0.3048 / u.lineLoad.f, w.Zx * IN ** 3 / (u.dim.f ** 3)];
    const h = findHss(String(name));
    if (h) { const base = fm.secRectHollow(h.B * IN, h.Ht * IN, h.t * IN); return [{ ...base, name: h.name, A: h.A * IN ** 2, Iy: h.Ix * IN ** 4, Iz: h.Iy * IN ** 4, J: h.J * IN ** 4 }, h.name, h.W * 4.4482216152605 / 0.3048 / u.lineLoad.f, h.Zx * IN ** 3 / (u.dim.f ** 3)]; }
    throw new Error(`"${name}" is not in the table. Use a name such as W12x26, W310x38.7 or HSS8x4x1/4.`);
  }, { noPreview: true, example: 'AISC Shape "W18x50" -> Section input of Beam' });

C('fe.load.asce7', 'ASCE 7 Combinations', 'ASCE7', 'Structure', 'The basic load combinations of ASCE 7 for the load cases you name. Leave a name empty if that load does not occur. "Lr or S or R" gives one combination for each roof load present, and wind and earthquake are taken in both directions. E is the whole seismic load effect; include its vertical part yourself. Special combinations (flood, ice, overstrength, self-straining) are not generated.',
  [int('Edition', '0 = ASCE 7-22, 1 = ASCE 7-16', 0, { nick: 'Ed' }), int('Method', '0 = strength design (LRFD), 1 = allowable stress design (ASD)', 0, { nick: 'M' }), txt('D', 'Name of the dead load case', 'D'), txt('L', 'Name of the live load case', 'L', { opt: true }), txt('Lr', 'Name of the roof live load case', '', { opt: true }), txt('S', 'Name of the snow load case', '', { opt: true }), txt('R', 'Name of the rain load case', '', { opt: true }), txt('W', 'Name of the wind load case', '', { opt: true }), txt('E', 'Name of the earthquake load case', '', { opt: true })],
  [P('Combinations', 'load', 'The load combinations, for the Loads input of Assemble Model', { list: true, nick: 'C' }), P('Names', 'text', 'Their names', { list: true, nick: 'N' }), P('Table', 'any', 'A table of the combinations for a Panel', { nick: 'T' })],
  ([ed, method, D, L, Lr, S, R, W, E]) => {
    const edition: Edition = ed === 1 ? '7-16' : '7-22', list = asce7(edition, method === 1 ? 'ASD' : 'LRFD', { D, L, Lr, S, R, W, E });
    const table: TableValue = { k: 'table', title: `ASCE ${edition} ${method === 1 ? 'ASD' : 'strength design'} combinations`, head: ['Eq.', 'Combination'], rows: list.map(c => [c.equation, c.name]), summary: `${list.length} load combinations` };
    return [list.map(c => combo(c.name, c.factors)), list.map(c => c.name), table];
  }, { noPreview: true, example: 'Name your load cases D, L and W, then wire Combinations into Assemble Model' });

C('fe.check.aisc', 'AISC 360 Check', 'AISC360', 'Structure', 'Strength check of a W-shape member by AISC 360-16: tension yielding, flexural buckling (with slender elements), flexure about both axes (lateral-torsional and flange local buckling), shear, and the interaction of axial force and bending (H1-1). Demands are the required strengths from your analysis; axial force is positive in tension. It does not cover connections, tension rupture, torsion or second-order effects, and it is not a substitute for an engineer\'s check.',
  [P('Section', 'section', 'A section made by AISC Shape', { nick: 'S' }), num('Fy', 'Yield stress', 345, { u: 'stress' }), num('Lb', 'Unbraced length for lateral-torsional buckling', 3, { u: 'len' }), num('Lcx', 'Effective length for buckling about the strong axis', 3, { u: 'len' }), num('Lcy', 'Effective length for buckling about the weak axis', 3, { u: 'len' }), num('Cb', 'Lateral-torsional buckling modification factor', 1), num('P', 'Required axial strength (tension positive)', 0, { u: 'force' }), num('Mx', 'Required flexural strength about the strong axis', 0, { u: 'moment' }), num('My', 'Required flexural strength about the weak axis', 0, { u: 'moment' }), num('V', 'Required shear strength', 0, { u: 'force' }), int('Method', '0 = LRFD, 1 = ASD', 0, { nick: 'M' })],
  [num('Ratio', 'Demand over capacity for combined axial force and bending (1 or less passes)', undefined, { nick: 'DCR' }), P('OK', 'boolean', 'True if every ratio is 1 or less'), num('Pc', 'Available compressive strength', undefined, { u: 'force' }), num('Pt', 'Available tensile yield strength', undefined, { u: 'force' }), num('Mcx', 'Available flexural strength, strong axis', undefined, { u: 'moment' }), num('Mcy', 'Available flexural strength, weak axis', undefined, { u: 'moment' }), num('Vc', 'Available shear strength', undefined, { u: 'force' }), P('Report', 'any', 'A table of the check for a Panel', { nick: 'R' })],
  ([sec, Fy, Lb, Lcx, Lcy, Cb, Pr, Mx, My, V, method], ctx) => {
    const s = (sec as any)?.aisc as WShape | undefined, u = U(ctx);
    if (!s) throw new Error('This check needs a W shape from the AISC Shape component');
    const r = checkW(s, { Fy: Fy * u.stress.f / KSI, Lb: Lb * u.len.f / IN, Lcx: Lcx * u.len.f / IN, Lcy: Lcy * u.len.f / IN, Cb, Pr: Pr * u.force.f / KIP, Mrx: Mx * u.moment.f / KIPIN, Mry: My * u.moment.f / KIPIN, Vr: V * u.force.f / KIP, method: method === 1 ? 'ASD' : 'LRFD' });
    for (const n of r.notes) ctx.warn(n);
    const F = (kip: number) => kip * KIP / u.force.f, M = (kin: number) => kin * KIPIN / u.moment.f, Ln = (inch: number) => inch * IN / u.len.f, pct = (x: number) => x.toFixed(3);
    const cap = r.method === 'LRFD' ? '\\phi' : '1/\\Omega\\,';
    const table: TableValue = { k: 'table', title: `${s.name}, AISC 360-16 (${r.method})`, head: ['Limit state', 'Available', 'Required', 'Ratio'], rows: [
      [`Compression $${cap}P_n$ (E3${r.slenderInCompression ? ', E7' : ''})`, `${g4(F(r.Pc))} ${u.force.label}`, Pr < 0 ? `${g4(-Pr)} ${u.force.label}` : '–', Pr < 0 ? pct(r.ratios.axial) : '–'],
      [`Tension yielding $${cap}P_n$ (D2)`, `${g4(F(r.Pt))} ${u.force.label}`, Pr > 0 ? `${g4(Pr)} ${u.force.label}` : '–', Pr > 0 ? pct(r.ratios.axial) : '–'],
      [`Flexure $${cap}M_{nx}$ (${r.governs})`, `${g4(M(r.Mcx))} ${u.moment.label}`, `${g4(Math.abs(Mx))} ${u.moment.label}`, pct(r.ratios.flexureX)],
      [`Flexure $${cap}M_{ny}$ (F6)`, `${g4(M(r.Mcy))} ${u.moment.label}`, `${g4(Math.abs(My))} ${u.moment.label}`, pct(r.ratios.flexureY)],
      [`Shear $${cap}V_n$ (G2.1)`, `${g4(F(r.Vc))} ${u.force.label}`, `${g4(Math.abs(V))} ${u.force.label}`, pct(r.ratios.shear)],
      [`Combined (${r.equation})`, '1.000', '', pct(r.ratios.combined)],
    ], foot: `$L_p$ = ${g4(Ln(r.Lp))} ${u.len.label}, $L_r$ = ${g4(Ln(r.Lr))} ${u.len.label}; flange ${r.flange}, web ${r.web}; $L_c/r$ = ${r.slenderness.toFixed(1)}. ${r.ok ? 'Passes these checks.' : 'Does not pass.'} Check against the Specification before relying on it.`, summary: `${s.name}: ratio ${pct(r.ratios.combined)} ${r.ok ? '(OK)' : '(not OK)'}` };
    return [r.ratios.combined, r.ok, F(r.Pc), F(r.Pt), M(r.Mcx), M(r.Mcy), F(r.Vc), table];
  }, { noPreview: true, example: 'AISC Shape -> AISC 360 Check, with P, Mx and V taken from Force Envelope' });

C('fe.check.aci', 'ACI 318 Beam Check', 'ACI318', 'Structure', 'Flexural and one-way shear strength of a rectangular reinforced concrete beam section by ACI 318-19: the rectangular stress block with strain compatibility, the strength reduction factor from the net tensile strain, and the shear strength of concrete and stirrups. It does not cover T-sections, axial load, torsion, detailing or deflection, and it is not a substitute for an engineer\'s check.',
  [num('b', 'Width of the section', 300, { u: 'dim' }), num('h', 'Total depth of the section', 500, { u: 'dim' }), num('d', 'Effective depth to the tension steel', 440, { u: 'dim' }), num('As', 'Area of tension steel', 12, { u: 'area' }), num('fc', 'Specified concrete strength f′c', 28, { u: 'stress' }), num('fy', 'Yield strength of the steel', 420, { u: 'stress' }), num('Av', 'Area of one set of stirrup legs (0 = none)', 0, { u: 'area' }), num('s', 'Stirrup spacing', 200, { u: 'dim' }), num('Mu', 'Factored moment', 0, { u: 'moment' }), num('Vu', 'Factored shear', 0, { u: 'force' }), num('As2', 'Area of compression steel (0 = none)', 0, { nick: 'A′s', u: 'area' }), num('d2', 'Depth to the compression steel', 60, { nick: 'd′', u: 'dim' })],
  [num('Ratio', 'The larger of the flexure and shear demand over capacity', undefined, { nick: 'DCR' }), P('OK', 'boolean', 'True if both ratios are 1 or less'), num('phiMn', 'Design flexural strength', undefined, { nick: 'φMn', u: 'moment' }), num('phiVn', 'Design shear strength', undefined, { nick: 'φVn', u: 'force' }), num('phi', 'Strength reduction factor for flexure', undefined, { nick: 'φ' }), num('epsT', 'Net tensile strain in the steel', undefined, { nick: 'εt' }), P('Report', 'any', 'A table of the check for a Panel', { nick: 'R' })],
  ([b, h, d, As, fc, fy, Av, s, Mu, Vu, As2, d2], ctx) => {
    const u = U(ctx), L = (x: number) => x * u.dim.f / IN, A = (x: number) => x * u.area.f / IN ** 2, PSI = KSI / 1000, LB = KIP / 1000;
    const r = checkBeam({ b: L(b), h: L(h), d: L(d), As: A(As), fc: fc * u.stress.f / PSI, fy: fy * u.stress.f / PSI, Av: A(Av), s: L(s), Mu: Mu * u.moment.f / (LB * IN), Vu: Vu * u.force.f / LB, AsPrime: A(As2), dPrime: L(d2) });
    for (const n of r.notes) ctx.warn(n);
    const M = (lbin: number) => lbin * LB * IN / u.moment.f, F = (lb: number) => lb * LB / u.force.f, D = (inch: number) => inch * IN / u.dim.f;
    const table: TableValue = { k: 'table', title: 'Rectangular beam, ACI 318-19', head: ['Quantity', 'Value'], rows: [
      ['Stress block depth $a$', `${g4(D(r.a))} ${u.dim.label}`], ['Neutral axis depth $c$', `${g4(D(r.c))} ${u.dim.label}`], ['Net tensile strain $\\varepsilon_t$', `${r.epsT.toFixed(5)} (${r.region})`], ['$\\phi$ for flexure', r.phi.toFixed(3)],
      ['$\\phi M_n$', `${g4(M(r.phiMn))} ${u.moment.label}`], ['$V_c$', `${g4(F(r.Vc))} ${u.force.label}`], ['$V_s$', `${g4(F(r.Vs))} ${u.force.label}`], ['$\\phi V_n$', `${g4(F(r.phiVn))} ${u.force.label}`],
      ['Flexure ratio $M_u/\\phi M_n$', r.ratios.flexure.toFixed(3)], ['Shear ratio $V_u/\\phi V_n$', r.ratios.shear.toFixed(3)],
    ], foot: `${r.ok ? 'Passes these checks.' : 'Does not pass.'} Check against the Code before relying on it.`, summary: `φMn = ${g4(M(r.phiMn))} ${u.moment.label}, φVn = ${g4(F(r.phiVn))} ${u.force.label}` };
    return [Math.max(r.ratios.flexure, r.ratios.shear), r.ok, M(r.phiMn), F(r.phiVn), r.phi, r.epsT, table];
  }, { noPreview: true, example: 'Mu and Vu from Force Envelope of a concrete frame' });
