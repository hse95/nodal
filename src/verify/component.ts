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

C('fe.benchmark', 'Verification Model', 'Verify', 'Structure', 'One of the built-in verification benchmarks: outputs its model, the analysis result and a table comparing computed and reference values. Pick the benchmark in the list. Benchmark models are defined in SI units.',
  [], [P('Model', 'model', 'The benchmark model', { nick: 'M' }), P('Result', 'result', 'Its analysis result', { nick: 'R' }), P('Table', 'text', 'Computed value, reference value, error and tolerance for each check', { list: true, nick: 'T' }), P('Pass', 'boolean', 'True when every check is within its tolerance', { nick: 'OK' })],
  async (_i, ctx) => {
    const id = (ctx.node.state.items ?? [])[ctx.node.state.index ?? 0]?.value, def = BENCHMARKS.find(b => b.id === id);
    if (!def) throw new Error('Unknown benchmark');
    const built = BUILDERS[def.builder](def.params);
    const result = await runJob({ type: 'analysis', model: built.model, options: built.options }, ctx.cancelled) as FEResult;
    const r = runBenchmark(def);
    const rows = [`${def.id} ${def.title} - ${r.pass ? 'PASS' : 'FAIL'}`, `Source: ${def.source}`, ...r.rows.map(row => `${row.pass ? 'ok' : 'FAIL'} | ${row.label} | computed ${fmtSci(row.computed)} ${row.unit} | reference ${fmtSci(row.expected)} ${row.unit} | error ${row.absolute ? row.errorPct.toExponential(2) : row.errorPct.toExponential(2) + ' %'} | tolerance ${row.absolute ? row.tolerancePct : row.tolerancePct + ' %'}`)];
    if (r.error) rows.push('Error: ' + r.error);
    return [built.model, result, rows, r.pass];
  }, { widget: 'valuelist', state: { items: BENCHMARKS.map(b => ({ name: `${b.id} ${b.title}`, value: b.id })), index: 0 }, width: 230, example: 'Verification Model -> Result View and Panel' });
