import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './setupCanvas.js',
    forceRerunTriggers: [
      '**/*.js',
      '**/*.{test,spec}.yaml',
      '**/*.{test,spec}.yml'
    ],
  },
});
