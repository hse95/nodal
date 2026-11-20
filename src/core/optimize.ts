/**
 * Single-objective evolutionary optimizer.
 *
 * A real-coded genetic algorithm (tournament selection, blend crossover,
 * Gaussian mutation, elitism) with an optional pattern-search polish of the
 * best individual (Hooke & Jeeves 1961). The fitness function is asynchronous
 * because, in the app, evaluating one design means re-running the graph.
 */
export interface Gene { min: number; max: number; integer?: boolean }
export interface GAOptions {
  population?: number; generations?: number; mutation?: number; crossover?: number; elite?: number;
  seed?: number; maximize?: boolean; localSearch?: boolean; localEvaluations?: number;
}
export interface Evaluated { x: number[]; f: number; generation: number }
export interface GAProgress { generation: number; best: Evaluated; mean: number; history: number[]; phase: 'evolution' | 'local search' }
export interface GAResult { best: Evaluated; history: number[]; top: Evaluated[]; evaluations: number; stopped: boolean }

export async function optimize(genes: Gene[], fitness: (x: number[]) => Promise<number>, opt: GAOptions = {}, onProgress?: (p: GAProgress) => void, shouldStop?: () => boolean): Promise<GAResult> {
  const pop = Math.max(4, opt.population ?? 24), gens = Math.max(1, opt.generations ?? 20), pm = opt.mutation ?? 0.15, pc = opt.crossover ?? 0.9, elite = Math.min(pop - 1, opt.elite ?? 2);
  const sign = opt.maximize ? -1 : 1;                    // internally always minimize sign*f
  let s = ((opt.seed ?? 1) * 2654435761) >>> 0;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const fix = (x: number[]) => x.map((val, i) => { const g = genes[i]; let c = Math.min(g.max, Math.max(g.min, val)); if (g.integer) c = Math.round(c); return c; });
  const cache = new Map<string, number>(), all: Evaluated[] = [];
  let evaluations = 0, generation = 0;
  const evalOne = async (x: number[]): Promise<number> => {
    const key = x.map(q => q.toPrecision(12)).join(',');
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let f = await fitness(x);
    if (!Number.isFinite(f)) f = sign * Infinity;        // failed designs are never selected
    evaluations++; cache.set(key, f); all.push({ x: [...x], f, generation });
    return f;
  };
  const better = (a: number, b: number) => sign * a < sign * b;
  let P: { x: number[]; f: number }[] = [];
  for (let i = 0; i < pop; i++) { const x = fix(genes.map(g => g.min + rnd() * (g.max - g.min))); P.push({ x, f: await evalOne(x) }); if (shouldStop?.()) break; }
  const history: number[] = [];
  const report = (phase: GAProgress['phase']) => {
    P.sort((a, b) => sign * a.f - sign * b.f);
    const finite = P.filter(p => Number.isFinite(p.f));
    history.push(P[0].f);
    onProgress?.({ generation, best: { ...P[0], generation }, mean: finite.reduce((t, p) => t + p.f, 0) / Math.max(1, finite.length), history: [...history], phase });
  };
  report('evolution');
  let stopped = !!shouldStop?.();
  for (generation = 1; generation <= gens && !stopped; generation++) {
    const pick = () => { const a = P[Math.floor(rnd() * P.length)], b = P[Math.floor(rnd() * P.length)]; return better(a.f, b.f) ? a : b; };
    const next = P.slice(0, elite).map(p => ({ ...p }));
    while (next.length < pop) {
      const a = pick(), b = pick();
      let x = a.x.map((val, i) => { if (rnd() > pc) return val; const u = rnd() * 1.5 - 0.25; return val + u * (b.x[i] - val); });     // BLX-0.25
      x = x.map((val, i) => (rnd() < pm ? val + gauss() * 0.1 * (genes[i].max - genes[i].min) : val));
      x = fix(x);
      next.push({ x, f: await evalOne(x) });
      if (shouldStop?.()) { stopped = true; break; }
    }
    P = next;
    report('evolution');
  }
  if (opt.localSearch && !stopped) {
    // Pattern search around the best design.
    P.sort((a, b) => sign * a.f - sign * b.f);
    let cur = { ...P[0] }, step = genes.map(g => 0.1 * (g.max - g.min)), budget = opt.localEvaluations ?? 60;
    while (budget > 0 && step.some((st, i) => st > (genes[i].integer ? 0.5 : 1e-4 * (genes[i].max - genes[i].min)))) {
      let improved = false;
      for (let i = 0; i < genes.length && budget > 0; i++) for (const dir of [1, -1]) {
        const x = fix(cur.x.map((val, k) => (k === i ? val + dir * (genes[i].integer ? Math.max(1, Math.round(step[i])) : step[i]) : val)));
        const f = await evalOne(x); budget--;
        if (better(f, cur.f)) { cur = { x, f }; improved = true; break; }
        if (shouldStop?.()) { budget = 0; stopped = true; break; }
      }
      if (!improved) step = step.map(st => st / 2);
      P[0] = cur; generation++; report('local search');
    }
  }
  const top = [...all].sort((a, b) => sign * a.f - sign * b.f).filter((e, i, arr) => i === 0 || e.f !== arr[i - 1].f).slice(0, 30);
  return { best: top[0], history, top, evaluations, stopped };
}
