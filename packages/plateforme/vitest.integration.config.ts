import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.itest.ts'], testTimeout: 90_000, hookTimeout: 180_000, fileParallelism: false },
});
