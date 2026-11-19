import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.itest.ts'], testTimeout: 120_000, hookTimeout: 120_000, fileParallelism: false },
});
