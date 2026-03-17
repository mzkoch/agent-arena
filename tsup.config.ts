import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      cli: 'src/cli.ts',
      index: 'src/index.ts'
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    bundle: true,
    splitting: false,
    target: 'node20',
    minify: false,
    shims: false,
    external: [
      'commander',
      'ink',
      'node-pty',
      'react',
      'react-devtools-core',
      'strip-ansi',
      'zod'
    ]
  }
]);
