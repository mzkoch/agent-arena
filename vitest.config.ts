import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: ['**/node_modules/**', '**/agent-arena-v2*/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        'bin/**',
        'dist/**',
        'eslint.config.cjs',
        'src/cli.ts',
        'src/index.ts',
        'src/domain/types.ts',
        'src/tui/**',
        'src/orchestrator/pty.ts',
        'tsup.config.ts',
        'vitest.config.ts',
        '**/*.test.ts',
        'agent-arena-v2*/**'
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
});
