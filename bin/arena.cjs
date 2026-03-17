#!/usr/bin/env node

(async () => {
  await import('../dist/cli.js');
})().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
