// Prints the verification table to the console: npx tsx scripts/bench-table.ts [id...]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBenchmark, fmtSci, BenchmarkDef } from '../src/verify/runner';

const dir = join(import.meta.dirname, '../src/verify/benchmarks');
const only = process.argv.slice(2);
const defs: BenchmarkDef[] = readdirSync(dir).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8'))).sort((a, b) => a.number - b.number);
let fail = 0;
for (const def of defs) {
  if (only.length && !only.includes(def.id)) continue;
  const r = runBenchmark(def);
  console.log(`\n${def.id} ${def.title}  [${r.pass ? 'PASS' : 'FAIL'}] ${r.ms.toFixed(0)} ms${r.error ? '  ERROR: ' + r.error : ''}`);
  for (const row of r.rows) {
    if (!row.pass) fail++;
    console.log(`  ${row.pass ? 'ok ' : 'XX '} ${row.label.padEnd(62)} ${fmtSci(row.computed).padStart(14)} ${fmtSci(row.expected).padStart(14)}  err ${row.errorPct.toExponential(2)}${row.absolute ? ' (abs)' : ' %'}  tol ${row.tolerancePct}`);
  }
  if (r.convergence) console.log('  convergence ' + r.convergence.param + ': ' + r.convergence.points.map(p => `${p.x}: ${p.errorPct.toExponential(2)}%`).join('  '));
  if (r.error) fail++;
}
console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed');
