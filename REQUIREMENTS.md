# Dynamic Model Validation with Provider Discovery and Error Recovery

## Overview

Implement dynamic model name validation for arena configs by querying each provider CLI at runtime, rather than hardcoding model lists. When an invalid model is specified, attempt to recover both at config time (with suggestions) and at launch time (by detecting agent failures due to bad models and retrying with a corrected model).

## Problem

Currently, there is no model validation. When an invalid model name is used (e.g. `gemini-3-pro` instead of `gemini-3-pro-preview`), the agent silently fails at launch time. Hardcoding model lists is not a viable solution because models change frequently and availability depends on the user's subscription.

## Requirements

### 1. Provider Model Discovery

Add a model discovery mechanism to the provider system. Each built-in provider should define how to discover available models at runtime:

**copilot-cli**: Run `copilot --help` and parse the `--model <model> (choices: ...)` section to extract the available model names.

**claude-code**: Claude Code does not enumerate models in `--help` — it says "provide an alias (e.g. 'sonnet' or 'opus') or a model's full name". For claude-code, skip strict model validation but still attempt discovery if a mechanism becomes available.

**Custom providers**: If a custom provider in arena.json declares a `modelDiscovery` config, use it. Otherwise skip validation for that provider.

### 2. Model Discovery Implementation

Add to the `ProviderConfig` type:
```typescript
modelDiscovery?: {
  command: string;     // CLI command to run (e.g. "copilot")
  args: string[];      // arguments (e.g. ["--help"])
  parseStrategy: string; // how to extract models (e.g. "choices-flag")
};
```

Implement a `discoverModels(provider: ProviderConfig): Promise<string[] | null>` function that:
- Runs the discovery command
- Parses the output using the specified strategy
- Returns the list of available models, or `null` if discovery is not available/fails
- Has a reasonable timeout (e.g. 5 seconds)

### 3. Caching

Cache discovered models to `.arena/.model-cache.json` with a structure like:
```json
{
  "copilot-cli": {
    "models": ["claude-opus-4.6", "gpt-5.4", ...],
    "discoveredAt": "2026-03-18T01:00:00Z",
    "ttlMs": 3600000
  }
}
```
- Cache TTL of 1 hour by default
- If cache is fresh, use it instead of shelling out
- If cache is stale or missing, rediscover

### 4. Validation Integration

Validate model names during `loadArenaConfig()` (at config parse time):
1. For each variant, look up its provider
2. Attempt model discovery for that provider
3. If discovery succeeds and the model is not in the list, throw a clear error with the valid options
4. If discovery fails (command not found, timeout, etc.), skip validation gracefully — don't block the user

### 5. Pre-Launch Error Recovery (Config Time)

When an invalid model is detected at config validation:
1. Compute string similarity (e.g. Levenshtein distance or simple substring matching) against the discovered model list
2. If a close match is found, include it in the error message as a suggestion: `Invalid model "gemini-3-pro" for provider "copilot-cli". Did you mean "gemini-3-pro-preview"?`
3. Always list all valid models in the error output

### 6. Post-Launch Error Recovery (Runtime)

When a variant agent fails shortly after launch due to a bad model name:
1. Detect the failure — the agent process exits quickly (within the first few seconds) with a non-zero exit code or produces an error message indicating an invalid model
2. Attempt to identify the closest valid model using the discovered model list
3. If a close match is found, automatically retry the agent with the corrected model name
4. Log the recovery attempt clearly: `Variant "gemini-agent" failed with model "gemini-3-pro". Retrying with "gemini-3-pro-preview".`
5. Update the variant's effective model in the session state so status/monitor reflect the corrected model
6. If retry also fails, mark the variant as failed with a clear error message
7. Limit retries to 1 attempt to avoid infinite loops

### 7. Parse Strategy: `choices-flag`

For the `choices-flag` parse strategy (used by copilot-cli):
- Look for the pattern `--model <model>` followed by `(choices: "model1", "model2", ...)`
- Extract all quoted strings from the choices list
- Handle multi-line output (the choices may span multiple lines)

## Implementation Notes

- Discovery should be async and handle the CLI not being installed (command not found)
- The `ProviderRegistry` should expose a `discoverModels(providerName)` method
- Keep the `supportedModels` field on `ProviderConfig` as a fallback — if populated, use it directly instead of running discovery. This lets custom providers declare a static list if they prefer.
- Built-in providers should use `modelDiscovery` instead of `supportedModels`
- The orchestrator's agent spawning logic needs a hook for detecting early model failures and retrying
- Tests should mock the command execution, not actually shell out to copilot/claude
- Recovery tests should simulate an agent failing with a model error and verify the retry with corrected model

## Validation

- `npm run build` must succeed
- `npm run lint` must pass with zero warnings
- `npx tsc --noEmit` must pass
- `npm run test` must pass
- `npx vitest run --coverage` — coverage must remain >80% on business-logic code
