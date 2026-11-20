/**
 * Cross-section sizing by repeated analysis.
 *
 * Members are grouped by their element ID. Each pass runs a linear static
 * analysis and gives every group the lightest candidate section whose
 * simplified stress utilization (see post.ts) stays at or below the target in
 * every load case/combination. Because changing sections changes the force
 * distribution in statically indeterminate structures, the loop repeats until
 * no group changes or the iteration limit is reached.
 *
 * This is a stress-based sizing aid, not a design-code check: member buckling,
 * deflection limits and detailing are not considered.
 */
import { FEModel, Section, sectionModuli } from './model';
import { solveStatic } from './analysis';
import type { FEResult } from './system';
import { memberStations, modelMass } from './post';

export interface SizingResult { model: FEModel; result: FEResult; log: string[]; mass: number; maxUtil: number; converged: boolean }

export function sizeSections(model: FEModel, candidates: Section[], target = 1, maxIter = 10, cancelled?: () => boolean): SizingResult {
  if (!candidates.length) throw new Error('Give the sizing component a list of candidate sections.');
  const cands = [...candidates].sort((a, b) => a.A - b.A);
  const m: FEModel = { ...model, sections: [...cands], beams: model.beams.map(b => ({ ...b, sec: 0 })) };
  const groups = new Map<string, number[]>();
  m.beams.forEach((b, e) => { const g = groups.get(b.id); if (g) g.push(e); else groups.set(b.id, [e]); });
  const log: string[] = [];
  let result = solveStatic(m, cancelled), converged = false, maxUtil = 0;
  for (let it = 1; it <= maxIter; it++) {
    const cases = m.combos.length ? result.cases.slice(m.cases.length) : result.cases;
    let changed = 0;
    maxUtil = 0;
    for (const [, els] of groups) {
      // Force demand of the group: all stations of all members in all cases.
      const demand: number[][] = [];
      for (const e of els) for (const c of cases) for (const f of memberStations(m, c, e, 6).f) demand.push([Math.abs(f[0]), m.beams[e].type === 'beam' ? Math.abs(f[4]) : 0, m.beams[e].type === 'beam' ? Math.abs(f[5]) : 0]);
      const fy = m.materials[m.beams[els[0]].mat].fy;
      const utilOf = (s: Section) => { const { Wy, Wz } = sectionModuli(s); let u = 0; for (const d of demand) u = Math.max(u, (d[0] / s.A + (Wy > 0 ? d[1] / Wy : 0) + (Wz > 0 ? d[2] / Wz : 0)) / fy); return u; };
      let pick = cands.length - 1;
      for (let k = 0; k < cands.length; k++) if (utilOf(cands[k]) <= target) { pick = k; break; }
      maxUtil = Math.max(maxUtil, utilOf(cands[pick]));
      if (pick !== m.beams[els[0]].sec) { changed++; for (const e of els) m.beams[e].sec = pick; }
    }
    log.push(`Pass ${it}: ${changed} group(s) changed, mass ${modelMass(m).toFixed(1)} kg, largest utilization ${(maxUtil * 100).toFixed(1)} %`);
    if (changed === 0) { converged = true; break; }
    result = solveStatic(m, cancelled);
  }
  if (!converged) { result = solveStatic(m, cancelled); log.push(`Stopped after ${maxIter} passes without settling (sections may still be alternating).`); }
  if (maxUtil > target + 1e-9) log.push(`Even the largest candidate section is over the target in at least one group (utilization ${(maxUtil * 100).toFixed(1)} %).`);
  return { model: m, result, log, mass: modelMass(m), maxUtil, converged };
}
