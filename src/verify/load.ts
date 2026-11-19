/** Loads every benchmark definition bundled with the app (Vite and Vitest both resolve the glob). */
import type { BenchmarkDef } from './runner';

const mods = import.meta.glob('./benchmarks/*.json', { eager: true }) as Record<string, { default: BenchmarkDef }>;
export const BENCHMARKS: BenchmarkDef[] = Object.values(mods).map(m => m.default).sort((a, b) => a.number - b.number);
