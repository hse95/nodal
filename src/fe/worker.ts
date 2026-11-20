/// <reference lib="webworker" />
/**
 * Solver worker. Receives { id, job } messages and answers with
 * { id, ok, result | error }. Cancellation is done by terminating the worker
 * from the main thread, so no shared state is needed here.
 */
import { executeJob, FEJob } from './client';

self.onmessage = (ev: MessageEvent<{ id: number; job: FEJob }>) => {
  const { id, job } = ev.data;
  try {
    const result = executeJob(job);
    (self as unknown as Worker).postMessage({ id, ok: true, result });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (e as Error).message || String(e) });
  }
};
