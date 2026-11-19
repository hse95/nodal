import { describe, it, expect } from 'vitest';
import { BENCHMARKS } from '../src/verify/load';
import { runBenchmark, fmtSci } from '../src/verify/runner';

describe('verification benchmarks', () => {
  for (const def of BENCHMARKS) {
    it(`${def.id} ${def.title}`, () => {
      const r = runBenchmark(def);
      expect(r.error, r.error).toBeUndefined();
      for (const row of r.rows) {
        const msg = `${def.id} "${row.label}": computed ${fmtSci(row.computed)}, expected ${fmtSci(row.expected)}, error ${row.errorPct.toExponential(2)}${row.absolute ? '' : ' %'} (tolerance ${row.tolerancePct}${row.absolute ? '' : ' %'})`;
        expect(row.pass, msg).toBe(true);
      }
    });
  }
});
