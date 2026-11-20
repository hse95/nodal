/**
 * Entry point used by graph components to run solver jobs.
 *
 * In the browser the app installs a runner that forwards jobs to a Web Worker
 * (see ui/feworker.ts) so the interface stays responsive and long analyses can
 * be cancelled. In Node (tests, scripts) jobs run directly.
 */
import type { FEModel, Section } from './model';
import { runAnalysis, AnalysisOptions } from './analysis';
import { sizeSections, SizingResult } from './sizing';
import type { FEResult } from './system';

export type FEJob =
  | { type: 'analysis'; model: FEModel; options: AnalysisOptions }
  | { type: 'sizing'; model: FEModel; sections: Section[]; target: number; maxIter: number };
export type FEJobResult = FEResult | SizingResult;

/** Executes a job synchronously; shared by the worker and the direct runner. */
export function executeJob(job: FEJob, cancelled?: () => boolean): FEJobResult {
  if (job.type === 'analysis') return runAnalysis(job.model, job.options, cancelled);
  return sizeSections(job.model, job.sections, job.target, job.maxIter, cancelled);
}
type Runner = (job: FEJob, cancelled: () => boolean) => Promise<FEJobResult>;
let runner: Runner = async (job, cancelled) => executeJob(job, cancelled);
export function setFERunner(r: Runner): void { runner = r; }
export function runJob(job: FEJob, cancelled: () => boolean = () => false): Promise<FEJobResult> { return runner(job, cancelled); }
