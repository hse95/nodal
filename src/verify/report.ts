/** The verification report as a PDF: what was checked, against what, with which tolerance, and the outcome. */
import { Pdf } from '../io/pdf';
import type { BenchmarkResult } from './runner';
import { texToPlain } from '../ui/Tex';

const sci = (x: number) => (x === 0 ? '0' : Math.abs(x) >= 1e5 || Math.abs(x) < 1e-3 ? x.toExponential(4) : Number(x.toPrecision(6)).toString());
export function verificationPdf(results: BenchmarkResult[], info: { version: string; date: string; browser: string }): Uint8Array {
  const pdf = new Pdf(), checks = results.flatMap(r => r.rows), passed = results.filter(r => r.pass).length, okChecks = checks.filter(c => c.pass).length, all = passed === results.length;
  pdf.paragraph('Nodal verification report', { size: 20, bold: true, gap: 2 });
  pdf.paragraph(`Version ${info.version} · ${info.date}`, { size: 10, color: [0.4, 0.43, 0.48], gap: 10 });
  pdf.rect(pdf.margin, pdf.y - 30, pdf.width - 2 * pdf.margin, 30, all ? [0.9, 0.96, 0.91] : [0.99, 0.91, 0.9]);
  pdf.text(pdf.margin + 10, pdf.y - 19, `${passed} of ${results.length} benchmarks pass (${okChecks} of ${checks.length} checks)`, { size: 12, bold: true, color: all ? [0.1, 0.45, 0.2] : [0.7, 0.15, 0.12] });
  pdf.y -= 42;
  pdf.paragraph('Every benchmark in this report was solved on the machine that made the report, by the same solver the app uses, and compared with a closed-form solution, a published reference value, or an independent reference solver. A check passes when the difference from the reference is within the stated tolerance. The same suite runs in the automated tests for every change to the code.', { size: 9.5 });
  pdf.paragraph('This report covers the structural solver. It does not replace an engineer\'s own check of a model and its results, and it says nothing about models outside the range of these benchmarks.', { size: 9.5, gap: 8 });
  pdf.paragraph(`Made in: ${info.browser}`, { size: 8, color: [0.45, 0.48, 0.53], gap: 12 });
  pdf.paragraph('Summary', { size: 13, bold: true, gap: 4 });
  pdf.table(['Benchmark', 'Checks', 'Largest error', 'Time', 'Result'], results.map(r => { const rel = r.rows.filter(c => !c.absolute); return [`${r.def.id} ${r.def.title}`, String(r.rows.length), rel.length ? Math.max(...rel.map(c => Math.abs(c.errorPct))).toPrecision(2) + ' %' : '-', `${r.ms.toFixed(0)} ms`, r.pass ? 'PASS' : 'FAIL']; }), [0.56, 0.09, 0.14, 0.1, 0.11], { align: ['left', 'right', 'right', 'right', 'left'], mark: row => (row[4] === 'PASS' ? [0.1, 0.5, 0.22] : [0.75, 0.15, 0.12]) });
  pdf.addPage();
  pdf.paragraph('Details', { size: 13, bold: true, gap: 6 });
  for (const r of results) {
    pdf.room(90);
    pdf.paragraph(`${r.def.id} ${r.def.title}`, { size: 11, bold: true, gap: 1 });
    pdf.paragraph(r.def.description, { size: 8.5, gap: 1 });
    pdf.paragraph(`Reference: ${r.def.source}`, { size: 8.5, color: [0.4, 0.43, 0.48], gap: 4 });
    if (r.error) pdf.paragraph(`Error: ${r.error}`, { size: 8.5, color: [0.75, 0.15, 0.12] });
    pdf.table(['Check', 'Computed', 'Reference', 'Error', 'Tolerance', 'Result'], r.rows.map(c => [c.label + (c.tex ? ` (${texToPlain(c.tex)})` : ''), `${sci(c.computed)} ${c.unit}`, `${sci(c.expected)} ${c.unit}`, c.absolute ? c.errorPct.toExponential(1) : c.errorPct.toPrecision(3) + ' %', c.absolute ? String(c.tolerancePct) : +c.tolerancePct.toPrecision(3) + ' %', c.pass ? 'PASS' : 'FAIL']), [0.36, 0.17, 0.17, 0.1, 0.1, 0.1], { align: ['left', 'right', 'right', 'right', 'right', 'left'], mark: row => (row[5] === 'PASS' ? [0.1, 0.5, 0.22] : [0.75, 0.15, 0.12]) });
  }
  return pdf.build({ title: `Nodal ${info.version} verification report`, author: 'Nodal' });
}
