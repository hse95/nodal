/**
 * Strength of a rectangular reinforced concrete beam section by ACI 318-19: flexure with tension steel
 * (and optional compression steel) by strain compatibility with the rectangular stress block (22.2),
 * the strength reduction factor from the net tensile strain (21.2), and one-way shear (22.5).
 * Not covered: T-sections, axial load, torsion, minimum and maximum spacing, development, deflection.
 * Everything here is in pounds and inches (psi).
 */
export interface BeamInput { b: number; h: number; d: number; As: number; fc: number; fy: number; dPrime?: number; AsPrime?: number; Av?: number; s?: number; fyt?: number; lambda?: number; Mu?: number; Vu?: number }
export interface BeamCheck {
  beta1: number; a: number; c: number; epsT: number; epsTy: number; phi: number; Mn: number; phiMn: number; region: 'tension-controlled' | 'transition' | 'compression-controlled';
  AsMin: number; rho: number; fsPrime: number;
  Vc: number; Vs: number; phiVn: number; AvMin: number; VsMax: number; sizeEffect: number;
  ratios: { flexure: number; shear: number }; ok: boolean; notes: string[];
}
const ES = 29e6;
export function checkBeam(o: BeamInput): BeamCheck {
  const { b, h, d, As, fc, fy } = o, lam = o.lambda ?? 1, notes: string[] = [];
  if (!(b > 0 && h > 0 && d > 0 && As > 0 && fc > 0 && fy > 0)) throw new Error('Width, depth, steel area and strengths must be positive');
  if (d >= h) throw new Error('The effective depth d must be less than the total depth h');
  const beta1 = fc <= 4000 ? 0.85 : Math.max(0.65, 0.85 - 0.05 * (fc - 4000) / 1000), Asp = o.AsPrime ?? 0, dp = o.dPrime ?? 2.5, epsTy = fy / ES;
  // Neutral axis by force equilibrium; the compression steel (if any) may not have yielded, so iterate on c.
  const force = (c: number) => { const fs = Asp > 0 ? Math.max(-fy, Math.min(fy, ES * 0.003 * (c - dp) / c)) : 0; return 0.85 * fc * beta1 * c * b + Asp * (fs - (beta1 * c > dp ? 0.85 * fc : 0)) - As * fy; };
  let lo = 1e-6, hi = h; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (force(mid) > 0) hi = mid; else lo = mid; }
  const c = (lo + hi) / 2, a = beta1 * c, epsT = 0.003 * (d - c) / c, fsPrime = Asp > 0 ? Math.max(-fy, Math.min(fy, ES * 0.003 * (c - dp) / c)) : 0;
  if (epsT < epsTy) notes.push('The tension steel does not yield before the concrete crushes; the strength shown assumes yielding and is not valid. Reduce the steel area or enlarge the section.');
  const Cs = Asp * (fsPrime - (a > dp ? 0.85 * fc : 0)), Mn = 0.85 * fc * a * b * (d - a / 2) + Cs * (d - dp);
  const region = epsT >= epsTy + 0.003 ? 'tension-controlled' : epsT <= epsTy ? 'compression-controlled' : 'transition';
  const phi = region === 'tension-controlled' ? 0.9 : region === 'compression-controlled' ? 0.65 : 0.65 + 0.25 * (epsT - epsTy) / 0.003;
  const AsMin = Math.max(3 * Math.sqrt(fc) / fy, 200 / fy) * b * d, rho = As / (b * d);
  if (As < AsMin) notes.push(`The steel area is below the minimum of ACI 318-19 Section 9.6.1.2 (${AsMin.toFixed(2)} in²).`);
  if (epsT < epsTy + 0.003) notes.push('The section is not tension-controlled; ACI 318-19 Section 9.3.3.1 requires beams to be tension-controlled.');
  // One-way shear (Table 22.5.5.1).
  const Av = o.Av ?? 0, s = o.s ?? 0, fyt = Math.min(o.fyt ?? fy, 60000), rootFc = Math.min(Math.sqrt(fc), 100), AvMin = s > 0 ? Math.max(0.75 * Math.sqrt(fc) * b * s / fyt, 50 * b * s / fyt) : 0;
  const sizeEffect = Math.min(1, Math.sqrt(2 / (1 + d / 10))), hasMin = Av > 0 && s > 0 && Av >= AvMin * 0.999;
  const Vc = Math.min(hasMin ? 2 * lam * rootFc * b * d : 8 * sizeEffect * lam * Math.cbrt(rho) * rootFc * b * d, 5 * lam * rootFc * b * d);
  const VsMax = 8 * rootFc * b * d, Vs = Av > 0 && s > 0 ? Math.min(Av * fyt * d / s, VsMax) : 0;
  if (Av > 0 && s > 0 && Av * fyt * d / s > VsMax) notes.push('The stirrup contribution is capped at 8√f′c·b·d (Section 22.5.1.2); the section is too small for this shear reinforcement.');
  if (Av > 0 && s > 0 && !hasMin) notes.push('The stirrups are less than the minimum shear reinforcement, so the concrete contribution is taken from the equation for members without it.');
  const phiVn = 0.75 * (Vc + Vs), phiMn = phi * Mn, ratios = { flexure: Math.abs(o.Mu ?? 0) / phiMn, shear: Math.abs(o.Vu ?? 0) / phiVn };
  return { beta1, a, c, epsT, epsTy, phi, Mn, phiMn, region, AsMin, rho, fsPrime, Vc, Vs, phiVn, AvMin, VsMax, sizeEffect, ratios, ok: ratios.flexure <= 1 && ratios.shear <= 1 && epsT >= epsTy, notes };
}
