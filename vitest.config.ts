import { defineConfig } from 'vitest/config';

// The solver, geometry and graph code is framework-free, so tests run in plain Node.
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 180000 },
});
