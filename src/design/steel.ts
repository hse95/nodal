/**
 * Strength of rolled wide-flange (W) members by AISC 360-16 (also the basis of AISC 360-22 for these
 * limit states): tension yielding (D2), flexural buckling with slender elements (E3, E7), major-axis
 * flexure (F2, F3), minor-axis flexure (F6), shear (G2.1) and combined force and flexure (H1.1).
 * Not covered: tension rupture and connections, torsion, torsional and flexural-torsional buckling,
 * second-order amplification (use a second-order analysis for the demands), and serviceability.
 * Everything here is in kips and inches.
 */
import { W_SHAPES, HSS_SHAPES, WRow } from '../data/aisc';

export interface WShape { name: string; W: number; A: number; d: number; bf: number; tw: number; tf: number; Ix: number; Zx: number; Sx: number; rx: number; Iy: number; Zy: number; Sy: number; ry: number; J: number; Cw: number; rts: number; ho: number; k: number }
const toShape = (r: WRow): WShape => { const [name, ...n] = r; const [W, A, d, bf, tw, tf, Ix, Zx, Sx, rx, Iy, Zy, Sy, ry, J, Cw, rts, ho, k] = n; return { name, W, A, d, bf, tw, tf, Ix, Zx, Sx, rx, Iy, Zy, Sy, ry, J, Cw, rts, ho, k }; };
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '').replace(/[×*]/g, 'X');
const METRIC_DEPTH: Record<number, number> = { 4: 100, 5: 130, 6: 150, 8: 200, 10: 250, 12: 310, 14: 360, 16: 410, 18: 460, 21: 530, 24: 610, 27: 690, 30: 760, 33: 840, 36: 920, 40: 1000, 44: 1100 };
/** The metric name of a W shape: nominal depth in mm and mass in kg/m, for example W12x26 -> W310x38.7. */
export function metricName(s: WShape): string { const m = /^W(\d+)x/.exec(s.name), kg = s.W * 1.48816; return `W${METRIC_DEPTH[Number(m?.[1])] ?? Math.round(s.d * 25.4)}x${kg >= 100 ? Math.round(kg) : Math.round(kg * 10) / 10}`; }
/** Find a W shape by its US name (W12x26) or its metric name (W310x38.7, also W310x39). */
export function findW(name: string): WShape | undefined {
  const key = norm(name), us = W_SHAPES.find(r => norm(r[0]) === key);
  if (us) return toShape(us);
  const m = /^W(\d+)X([\d.]+)$/.exec(key); if (!m) return undefined;
  const depth = Number(m[1]), mass = Number(m[2]); let best: WShape | undefined, err = Infinity;
  for (const r of W_SHAPES) { const s = toShape(r), mm = /^W(\d+)x/.exec(s.name); if (METRIC_DEPTH[Number(mm?.[1])] !== depth) continue; const e = Math.abs(s.W * 1.48816 - mass); if (e < err) { err = e; best = s; } }
  return best && err <= Math.max(0.6, 0.012 * mass) ? best : undefined;
}
export const wNames = (): string[] => W_SHAPES.map(r => r[0]);
export interface HssShape { name: string; W: number; A: number; Ht: number; B: number; t: number; Ix: number; Zx: number; Sx: number; rx: number; Iy: number; Zy: number; Sy: number; ry: number; J: number }
export function findHss(name: string): HssShape | undefined { const key = norm(name).replace(/-/g, ''), r = HSS_SHAPES.find(x => norm(x[0]) === key); if (!r) return undefined; const [nm, ...n] = r; const [W, A, Ht, B, t, Ix, Zx, Sx, rx, Iy, Zy, Sy, ry, J] = n; return { name: nm, W, A, Ht, B, t, Ix, Zx, Sx, rx, Iy, Zy, Sy, ry, J }; }
export const hssNames = (): string[] => HSS_SHAPES.map(r => r[0]);

export interface SteelInput { Fy: number; E?: number; Lb: number; Lcx: number; Lcy: number; Cb?: number; Pr?: number; Mrx?: number; Mry?: number; Vr?: number; method?: 'LRFD' | 'ASD' }
export interface SteelCheck {
  method: 'LRFD' | 'ASD';
  /** Available strengths (phi*Rn for LRFD, Rn/Omega for ASD). */
  Pc: number; Pt: number; Mcx: number; Mcy: number; Vc: number;
  /** Nominal values and intermediate quantities, for reporting. */
  Pn: number; Fcr: number; Fe: number; slenderness: number; Ae: number; Mnx: number; Mny: number; Mp: number; Lp: number; Lr: number; Vn: number;
  flange: 'compact' | 'noncompact' | 'slender'; web: 'compact' | 'noncompact' | 'slender'; slenderInCompression: boolean;
  ltb: 'yielding' | 'inelastic lateral-torsional buckling' | 'elastic lateral-torsional buckling'; governs: string;
  ratios: { axial: number; flexureX: number; flexureY: number; shear: number; combined: number };
  equation: string; ok: boolean; notes: string[];
}
/** Effective area of a W shape in compression with slender elements, AISC 360-16 Section E7. */
function effectiveArea(s: WShape, Fy: number, E: number, Fcr: number): number {
  const h = s.d - 2 * s.k, parts: { b: number; t: number; lam: number; lr: number; c1: number; c2: number; n: number }[] = [
    { b: h, t: s.tw, lam: h / s.tw, lr: 1.49 * Math.sqrt(E / Fy), c1: 0.18, c2: 1.31, n: 1 },                       // web (stiffened)
    { b: s.bf / 2, t: s.tf, lam: s.bf / (2 * s.tf), lr: 0.56 * Math.sqrt(E / Fy), c1: 0.22, c2: 1.49, n: 4 },        // flange outstands (unstiffened)
  ];
  let Ae = s.A;
  for (const p of parts) {
    if (p.lam <= p.lr * Math.sqrt(Fy / Fcr)) continue;
    const Fel = (p.c2 * p.lr / p.lam) ** 2 * Fy, r = Math.sqrt(Fel / Fcr), be = Math.min(p.b, p.b * (1 - p.c1 * r) * r);
    Ae -= p.n * (p.b - be) * p.t;
  }
  return Ae;
}
export function checkW(s: WShape, o: SteelInput): SteelCheck {
  const E = o.E ?? 29000, Fy = o.Fy, Cb = o.Cb ?? 1, method = o.method ?? 'LRFD', notes: string[] = [];
  if (!(Fy > 0) || !(E > 0)) throw new Error('Fy and E must be positive');
  if (o.Lb < 0 || o.Lcx < 0 || o.Lcy < 0) throw new Error('Lengths cannot be negative');
  const avail = (Rn: number, phi: number, omega: number) => (method === 'LRFD' ? phi * Rn : Rn / omega);
  const rootEF = Math.sqrt(E / Fy), h = s.d - 2 * s.k, lamF = s.bf / (2 * s.tf), lamW = h / s.tw;
  // ---- tension (D2: yielding of the gross section)
  const Pt = avail(Fy * s.A, 0.9, 1.67);
  // ---- compression (E3, with E7 for slender elements)
  const slend = Math.max(o.Lcx / s.rx, o.Lcy / s.ry), Fe = slend > 0 ? Math.PI ** 2 * E / slend ** 2 : Infinity;
  const Fcr = slend <= 4.71 * rootEF ? Math.pow(0.658, Fy / Fe) * Fy : 0.877 * Fe;
  const slenderC = lamF > 0.56 * rootEF || lamW > 1.49 * rootEF, Ae = slenderC ? effectiveArea(s, Fy, E, Fcr) : s.A, Pn = Fcr * Ae, Pc = avail(Pn, 0.9, 1.67);
  if (slend > 200) notes.push(`The slenderness ${slend.toFixed(0)} is above 200, the limit AISC recommends for compression members.`);
  if (slenderC) notes.push('The section has slender elements in compression; the effective area of Section E7 is used.');
  // ---- flexure about the strong axis (F2 and F3)
  const Mp = Fy * s.Zx, Mr = 0.7 * Fy * s.Sx, lpF = 0.38 * rootEF, lrF = 1.0 * rootEF, lpW = 3.76 * rootEF, lrW = 5.70 * rootEF;
  const flange = lamF <= lpF ? 'compact' : lamF <= lrF ? 'noncompact' : 'slender', web = lamW <= lpW ? 'compact' : lamW <= lrW ? 'noncompact' : 'slender';
  if (web !== 'compact') notes.push('The web is not compact in flexure; Sections F4 and F5 are not covered, so the flexural strength shown is not valid for this shape.');
  const Lp = 1.76 * s.ry * rootEF, c = 1, jc = s.J * c / (s.Sx * s.ho), Lr = 1.95 * s.rts * (E / (0.7 * Fy)) * Math.sqrt(jc + Math.sqrt(jc * jc + 6.76 * (0.7 * Fy / E) ** 2));
  let Mltb: number, ltb: SteelCheck['ltb'];
  if (o.Lb <= Lp) { Mltb = Mp; ltb = 'yielding'; }
  else if (o.Lb <= Lr) { Mltb = Math.min(Mp, Cb * (Mp - (Mp - Mr) * (o.Lb - Lp) / (Lr - Lp))); ltb = 'inelastic lateral-torsional buckling'; }
  else { const sl = o.Lb / s.rts; Mltb = Math.min(Mp, Cb * Math.PI ** 2 * E / sl ** 2 * Math.sqrt(1 + 0.078 * jc * sl ** 2) * s.Sx); ltb = 'elastic lateral-torsional buckling'; }
  const kc = Math.min(0.76, Math.max(0.35, 4 / Math.sqrt(lamW)));
  const Mflb = flange === 'compact' ? Mp : flange === 'noncompact' ? Mp - (Mp - Mr) * (lamF - lpF) / (lrF - lpF) : 0.9 * E * kc * s.Sx / lamF ** 2;
  const Mnx = Math.min(Mltb, Mflb), Mcx = avail(Mnx, 0.9, 1.67);
  const governs = Mflb < Mltb ? 'compression flange local buckling' : Mltb < Mp ? ltb : 'yielding (plastic moment)';
  // ---- flexure about the weak axis (F6)
  const Mpy = Math.min(Fy * s.Zy, 1.6 * Fy * s.Sy), Mny = flange === 'compact' ? Mpy : flange === 'noncompact' ? Mpy - (Mpy - 0.7 * Fy * s.Sy) * (lamF - lpF) / (lrF - lpF) : 0.69 * E / lamF ** 2 * s.Sy, Mcy = avail(Mny, 0.9, 1.67);
  // ---- shear in the web (G2.1)
  const Aw = s.d * s.tw, kv = 5.34, rolled = lamW <= 2.24 * rootEF, Cv1 = rolled || lamW <= 1.10 * Math.sqrt(kv * E / Fy) ? 1 : 1.10 * Math.sqrt(kv * E / Fy) / lamW, Vn = 0.6 * Fy * Aw * Cv1, Vc = rolled ? avail(Vn, 1.0, 1.5) : avail(Vn, 0.9, 1.67);
  // ---- demands and interaction (H1.1)
  const Pr = o.Pr ?? 0, Mrx = Math.abs(o.Mrx ?? 0), Mry = Math.abs(o.Mry ?? 0), Vr = Math.abs(o.Vr ?? 0), Pcap = Pr < 0 ? Pc : Pt, pr = Math.abs(Pr) / Pcap, bend = Mrx / Mcx + Mry / Mcy;
  const combined = pr >= 0.2 ? pr + 8 / 9 * bend : pr / 2 + bend, equation = pr >= 0.2 ? 'H1-1a' : 'H1-1b';
  const ratios = { axial: pr, flexureX: Mrx / Mcx, flexureY: Mry / Mcy, shear: Vr / Vc, combined };
  return { method, Pc, Pt, Mcx, Mcy, Vc, Pn, Fcr, Fe, slenderness: slend, Ae, Mnx, Mny, Mp, Lp, Lr, Vn, flange, web, slenderInCompression: slenderC, ltb, governs, ratios, equation, ok: Math.max(combined, ratios.shear) <= 1 && web === 'compact', notes };
}
