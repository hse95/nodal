/**
 * Convenience constructors for structural parts. Used by the graph components,
 * the benchmark builders and the examples, so that all three create models
 * through the same code path.
 */
import { V3, v, lerp, dist } from '../geom/vec';
import type { BeamPart, ShellPart, SupportPart, LoadPart, Material, Section, MemberType } from './model';
import type { Plane } from '../geom/vec';
import { Mesh, mv } from '../geom/mesh';

export interface BeamOptions {
  id?: string; type?: MemberType; shear?: boolean; ref?: V3 | null; angle?: number;
  /** Release flags: 12 booleans, or a string such as "ry,rz" applied to the start / end. */
  relStart?: string; relEnd?: string; rel?: boolean[];
  offA?: V3 | null; offB?: V3 | null; pre?: number; l0?: number;
}
const DOF_KEYS = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
/** "ry, rz" -> six flags. Also accepts "pin" (ry, rz), "ball" (rx, ry, rz) and the digit form "000011". */
export function parseDofs(s: string | undefined | null): boolean[] {
  const out = [false, false, false, false, false, false];
  if (!s) return out;
  const t = s.trim().toLowerCase();
  if (/^[01]{6}$/.test(t)) return t.split('').map(c => c === '1');
  if (t === 'pin' || t === 'hinge') return [false, false, false, false, true, true];
  if (t === 'ball') return [false, false, false, true, true, true];
  if (t === 'fixed' || t === 'all') return [true, true, true, true, true, true];
  if (t === 'pinned') return [true, true, true, false, false, false];
  for (const tok of t.split(/[\s,;]+/).filter(x => x)) {
    const i = DOF_KEYS.indexOf(tok.replace(/^t/, 'u').replace(/^([xyz])$/, 'u$1'));
    if (i < 0) throw new Error(`Unknown degree of freedom "${tok}". Use ux, uy, uz, rx, ry, rz.`);
    out[i] = true;
  }
  return out;
}
export function beam(a: V3, b: V3, mat: Material, sec: Section, o: BeamOptions = {}): BeamPart {
  const rel = o.rel ?? [...parseDofs(o.relStart), ...parseDofs(o.relEnd)];
  const type = o.type ?? 'beam';
  return {
    k: 'element', kind: 'beam', id: o.id ?? 'B', a, b, type, mat, sec, shear: o.shear ?? false, ref: o.ref ?? null, angle: o.angle ?? 0,
    rel, offA: o.offA ?? null, offB: o.offB ?? null, pre: o.pre ?? 0, l0: o.l0 ?? 1, ci: 0, cn: 1,
    summary: `${type === 'beam' ? 'Beam' : type[0].toUpperCase() + type.slice(1)} "${o.id ?? 'B'}" L=${+dist(a, b).toFixed(3)} m, ${sec.name}, ${mat.name}`,
  };
}
/** A straight member split into n elements. Releases and offsets apply to the outer ends only. */
export function beamChain(a: V3, b: V3, n: number, mat: Material, sec: Section, o: BeamOptions = {}): BeamPart[] {
  const out: BeamPart[] = [], rs = parseDofs(o.relStart), re = parseDofs(o.relEnd), none = parseDofs('');
  const full = o.rel ?? [...rs, ...re];
  for (let i = 0; i < n; i++) {
    const rel = [...(i === 0 ? full.slice(0, 6) : none), ...(i === n - 1 ? full.slice(6) : none)];
    out.push(beam(lerp(a, b, i / n), lerp(a, b, (i + 1) / n), mat, sec, { ...o, rel, relStart: undefined, relEnd: undefined, offA: i === 0 ? o.offA : null, offB: i === n - 1 ? o.offB : null }));
    out[i].ci = i; out[i].cn = n;
  }
  return out;
}
export function shell(pts: V3[], mat: Material, t: number, id = 'S'): ShellPart {
  return { k: 'element', kind: 'shell', id, pts, mat, t, summary: `Shell "${id}" t=${+(t * 1000).toFixed(1)} mm, ${mat.name}` };
}
export function shellsFromMesh(m: Mesh, mat: Material, t: number, id = 'S'): ShellPart[] {
  const out: ShellPart[] = [];
  for (const f of m.f) {
    if (f.length === 3 || f.length === 4) out.push(shell(f.map(i => mv(m, i)), mat, t, id));
    else for (let i = 1; i + 1 < f.length; i++) out.push(shell([mv(m, f[0]), mv(m, f[i]), mv(m, f[i + 1])], mat, t, id));
  }
  return out;
}
export function support(p: V3, fix: string | boolean[] = 'fixed', o: { axes?: Plane | null; disp?: number[] | null; spring?: number[] | null } = {}): SupportPart {
  const f = typeof fix === 'string' ? parseDofs(fix) : fix;
  const names = f.map((x, i) => (x ? DOF_KEYS[i] : '')).filter(x => x).join(' ');
  return { k: 'support', p, fix: f, axes: o.axes ?? null, disp: o.disp ?? null, spring: o.spring ?? null, summary: `Support at (${+p.x.toFixed(3)}, ${+p.y.toFixed(3)}, ${+p.z.toFixed(3)}) fixing ${names || 'nothing'}${o.spring ? ' + springs' : ''}` };
}
export function pointLoad(p: V3, f: V3, m: V3 = v(), lc = 'LC1'): LoadPart {
  return { k: 'load', kind: 'point', p, f, m, lc, summary: `Point load (${f.x}, ${f.y}, ${f.z}) N in ${lc}` };
}
export function lineLoad(w1: V3, w2: V3 = w1, o: { ids?: string[] | null; sys?: 'global' | 'local' | 'projected'; lc?: string } = {}): LoadPart {
  return { k: 'load', kind: 'line', ids: o.ids ?? null, w1, w2, sys: o.sys ?? 'global', lc: o.lc ?? 'LC1', summary: `Line load (${w1.x}, ${w1.y}, ${w1.z}) N/m in ${o.lc ?? 'LC1'}` };
}
export function gravityLoad(dir: V3 = v(0, 0, -1), lc = 'LC1'): LoadPart { return { k: 'load', kind: 'gravity', dir, lc, summary: `Self-weight x (${dir.x}, ${dir.y}, ${dir.z}) g in ${lc}` }; }
export function tempLoad(dT: number, gy = 0, gz = 0, ids: string[] | null = null, lc = 'LC1'): LoadPart { return { k: 'load', kind: 'temp', ids, dT, gy, gz, lc, summary: `Temperature dT=${dT} K in ${lc}` }; }
export function pressureLoad(p: number, o: { dir?: V3 | null; projected?: boolean; ids?: string[] | null; lc?: string } = {}): LoadPart {
  return { k: 'load', kind: 'pressure', ids: o.ids ?? null, p, dir: o.dir ?? null, projected: !!o.projected, lc: o.lc ?? 'LC1', summary: `Area load ${p} Pa in ${o.lc ?? 'LC1'}` };
}
export function combo(name: string, factors: Record<string, number>): LoadPart {
  return { k: 'load', kind: 'combo', lc: name, factors, summary: `Combination ${name} = ${Object.entries(factors).map(([k, f]) => `${f} ${k}`).join(' + ')}` };
}
