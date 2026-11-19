import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.itest.ts'], testTimeout: 60_000, fileParallelism: false },
});
