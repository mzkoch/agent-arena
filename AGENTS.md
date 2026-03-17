# Agent Instructions

## Build & Test

```bash
npm run build          # Build with tsup
npm run test           # Run all tests
npm run lint           # Lint (zero warnings allowed)
npx tsc --noEmit       # Type check
npx vitest run --coverage  # Run tests with coverage report
```

All tests must pass with **>80% coverage** on business-logic code before pushing.

## Running Agent Arena

Use the CLI directly:

```bash
arena init                                                    # scaffold default arena
arena init --config arena.json --requirements requirements.md # copy existing files
arena init my-arena --config arena.json --requirements req.md # named arena
arena launch
arena launch my-arena --headless
arena monitor
arena status
arena evaluate
arena clean
```

## Corrections & Learning

When you are corrected by the user:

1. **Store it in memory** using `store_memory` so the correction persists across sessions.
2. **Append the correction to this file** under the "Learned Conventions" section below, so future agents benefit immediately.

## Learned Conventions

- **Documentation**: Before submitting a PR, verify that README.md, DESIGN.md, and AGENTS.md are up to date with your changes. If you added or changed types, config fields, or provider behavior, update the relevant docs.

<!-- Add corrections and conventions here as they are learned. Format: -->
<!-- - **Topic**: Description of the correct approach. -->
