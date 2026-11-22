/**
 * "Verification Model" component: loads one of the bundled benchmarks into the
 * graph, runs it, and outputs the model, the result and the comparison table,
 * so every benchmark can be opened as a one-click example.
 */
import { P } from '../core/graph';
import { C } from '../components/basic';
import { BENCHMARKS } from './load';
import { BUILDERS } from './builders';
import { runBenchmark, fmtSci } from './runner';
import { runJob } from '../fe/client';
import type { FEResult } from '../fe/system';
import type { TableValue } from '../core/types';

C('fe.benchmark', 'Verification Model', 'Verify', 'Structure', 'One of the built-in verification benchmarks: outputs its model, the analysis result and a table comparing computed and reference values. Pick the benchmark in the list. Benchmark models are defined in SI units.',
  [], [P('Model', 'model', 'The benchmark model', { nick: 'M' }), P('Result', 'result', 'Its analysis result', { nick: 'R' }), P('Table', 'any', 'Computed value, reference value and error for each check, as a table (connect a Panel)', { nick: 'T' }), P('Pass', 'boolean', 'True when every check is within its tolerance', { nick: 'OK' })],
  async (_i, ctx) => {
    const id = (ctx.node.state.items ?? [])[ctx.node.state.index ?? 0]?.value, def = BENCHMARKS.find(b => b.id === id);
    if (!def) throw new Error('Unknown benchmark');
    const built = BUILDERS[def.builder](def.params);
    const result = await runJob({ type: 'analysis', model: built.model, options: built.options }, ctx.cancelled) as FEResult;
    const r = runBenchmark(def);
    const table = benchmarkTable(r);
    return [built.model, result, table, r.pass];
  }, { widget: 'valuelist', state: { items: BENCHMARKS.map(b => ({ name: `${b.id} ${b.title}`, value: b.id })), index: 0 }, width: 230, example: 'Verification Model -> Result View and Panel' });

/** The comparison of computed and reference values as a table for a Panel. */
export function benchmarkTable(r: ReturnType<typeof runBenchmark>): TableValue {
  const def = r.def;
  return {
      k: 'table', title: `${def.id} ${def.title}: ${r.pass ? 'pass' : 'FAIL'}`, head: ['Check', 'Formula', 'Computed', 'Reference', 'Error', ''],
      rows: r.rows.map(row => [row.label, row.tex ? `$${row.tex}$` : '', `${fmtSci(row.computed)} ${row.unit}`, `${fmtSci(row.expected)} ${row.unit}`, row.absolute ? row.errorPct.toExponential(1) : `${row.errorPct < 1e-9 ? '< 1e-9' : row.errorPct.toPrecision(2)} %`, row.pass ? '✓' : '✗']),
      foot: (r.error ? `Error: ${r.error}. ` : '') + `Source: ${def.source}`,
      summary: `${def.id} ${def.title}: ${r.rows.filter(x => x.pass).length} of ${r.rows.length} checks pass`,
    };
}

C('fe.benchmark.check', 'Verification Check', 'Check', 'Structure', 'Compares an analysis result with the reference values of a verification benchmark. It is used when a benchmark is opened as ordinary components: the result of that graph goes in, and the table shows whether it still matches the published answers. The reference values belong to the original dimensions and loads, so changing those is expected to make checks fail.',
  [P('Result', 'result', 'The analysis result of the rebuilt benchmark model', { nick: 'R' })],
  [P('Table', 'any', 'Computed value, reference value and error for each check, as a table (connect a Panel)', { nick: 'T' }), P('Pass', 'boolean', 'True when every check is within its tolerance', { nick: 'OK' })],
  ([res], ctx) => {
    const id = (ctx.node.state.items ?? [])[ctx.node.state.index ?? 0]?.value, def = BENCHMARKS.find(b => b.id === id);
    if (!def) throw new Error('Unknown benchmark');
    const r = runBenchmark(def, res as FEResult);
    if (r.error) throw new Error(r.error);
    return [benchmarkTable(r), r.pass];
  }, { widget: 'valuelist', state: { items: BENCHMARKS.map(b => ({ name: `${b.id} ${b.title}`, value: b.id })), index: 0 }, width: 230, noPreview: true });
