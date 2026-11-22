/**
 * Benchmark runner shared by the automated tests, the in-app Verification
 * panel and the verification report generator.
 */
import { BUILDERS, Params } from './builders';
import { runAnalysis } from '../fe/analysis';
import { evalExpr } from '../core/expr';
import type { FEResult } from '../fe/system';

export interface CheckDef {
  label: string;
  /** The reference formula in TeX, shown typeset next to the label. */
  tex?: string;
  quantity: string;
  /** Closed-form expression in the benchmark parameters, a literal value, or a named value from the builder's reference(). */
  expected: { formula?: string; value?: number; reference?: string };
  /** Relative tolerance (0.001 = 0.1 %). */
  tolerance: number;
  /** Absolute tolerance, used when the expected value is zero. */
  abs?: number;
  /** Parameter overrides for this check. */
  params?: Params;
  /** Builder override for this check (defaults to the benchmark's builder). */
  builder?: string;
  unit?: string;
  note?: string;
}
export interface BenchmarkDef {
  id: string; number: number; group: string; title: string; description: string; source: string;
  builder: string; params: Params; checks: CheckDef[];
  convergence?: { param: string; values: number[]; check: number; label?: string };
}
export interface CheckResult { label: string; tex?: string; computed: number; expected: number; errorPct: number; tolerancePct: number; pass: boolean; unit: string; note?: string; absolute: boolean }
export interface BenchmarkResult {
  def: BenchmarkDef; rows: CheckResult[]; pass: boolean; ms: number; error?: string;
  convergence?: { param: string; label: string; expected: number; points: { x: number; computed: number; errorPct: number }[] };
}

function evaluate(def: BenchmarkDef, check: CheckDef, params: Params, cache: Map<string, { built: ReturnType<typeof BUILDERS[string]>; result: FEResult }>): { computed: number; expected: number } {
  const name = check.builder ?? def.builder, key = name + JSON.stringify(params);
  let hit = cache.get(key);
  if (!hit) {
    const builder = BUILDERS[name];
    if (!builder) throw new Error(`Unknown benchmark builder "${name}"`);
    const built = builder(params);
    hit = { built, result: runAnalysis(built.model, built.options) };
    cache.set(key, hit);
  }
  const q = hit.built.quantities[check.quantity];
  if (!q) throw new Error(`Builder "${name}" has no quantity "${check.quantity}"`);
  let expected: number;
  if (check.expected.formula !== undefined) expected = evalExpr(check.expected.formula, params);
  else if (check.expected.reference !== undefined) {
    const ref = hit.built.reference?.();
    if (!ref || !(check.expected.reference in ref)) throw new Error(`No reference value "${check.expected.reference}"`);
    expected = ref[check.expected.reference];
  } else expected = check.expected.value ?? 0;
  return { computed: q(hit.result), expected };
}

/**
 * Run a benchmark. With `given`, the checks on the benchmark's own model are evaluated on that result
 * instead of solving the model here: this is how a benchmark rebuilt from ordinary components is
 * verified. (Checks that use a different model or other parameters are still solved here.)
 */
export function runBenchmark(def: BenchmarkDef, given?: FEResult): BenchmarkResult {
  const t0 = performance.now(), rows: CheckResult[] = [];
  const cache = new Map<string, any>();
  try {
    if (given) cache.set(def.builder + JSON.stringify({ ...def.params }), { built: BUILDERS[def.builder](def.params), result: given });
    for (const check of def.checks) {
      const { computed, expected } = evaluate(def, check, check.builder ? { ...(check.params ?? {}) } : { ...def.params, ...(check.params ?? {}) }, cache);
      const absolute = expected === 0 || (check.abs !== undefined && Math.abs(expected) < check.abs);
      const err = absolute ? Math.abs(computed - expected) : Math.abs(computed - expected) / Math.abs(expected);
      const pass = Number.isFinite(computed) && (absolute ? err <= (check.abs ?? check.tolerance) : err <= check.tolerance);
      rows.push({ label: check.label, tex: check.tex, computed, expected, errorPct: absolute ? err : err * 100, tolerancePct: absolute ? (check.abs ?? check.tolerance) : check.tolerance * 100, pass, unit: check.unit ?? '', note: check.note, absolute });
    }
    let convergence: BenchmarkResult['convergence'];
    if (def.convergence && !given) {
      const c = def.convergence, check = def.checks[c.check];
      const points = c.values.map(x => {
        const r = evaluate(def, check, { ...def.params, ...(check.params ?? {}), [c.param]: x }, cache);
        return { x, computed: r.computed, errorPct: Math.abs(r.computed - r.expected) / Math.abs(r.expected) * 100, expected: r.expected };
      });
      convergence = { param: c.param, label: c.label ?? check.label, expected: points[points.length - 1].expected, points };
    }
    return { def, rows, pass: rows.every(r => r.pass), ms: performance.now() - t0, convergence };
  } catch (e) {
    return { def, rows, pass: false, ms: performance.now() - t0, error: (e as Error).message };
  }
}
export const fmtSci = (x: number): string => (x === 0 ? '0' : Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3 ? x.toExponential(5) : String(parseFloat(x.toPrecision(7))));
