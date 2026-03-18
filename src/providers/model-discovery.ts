import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelDiscoveryConfig, ProviderConfig } from '../domain/types';

const execFileAsync = promisify(execFile);

const DISCOVERY_TIMEOUT_MS = 5_000;

export interface CommandExecutor {
  (command: string, args: string[], options: { timeout: number }): Promise<{ stdout: string; stderr: string }>;
}

const defaultExecutor: CommandExecutor = async (command, args, options) => {
  return execFileAsync(command, args, { timeout: options.timeout });
};

/**
 * Parse models from `--model <model> (choices: "model1", "model2", ...)` output.
 * Handles multi-line output where choices may wrap across lines.
 */
export const parseChoicesFlag = (output: string): string[] => {
  // Match --model followed by (choices: ...) potentially spanning multiple lines
  const pattern = /--model\b[^(]*\(choices:\s*([\s\S]*?)\)/i;
  const match = output.match(pattern);
  if (!match?.[1]) {
    return [];
  }

  const choicesBlock = match[1];
  const models: string[] = [];
  const quotePattern = /"([^"]+)"/g;
  let quoteMatch: RegExpExecArray | null;
  while ((quoteMatch = quotePattern.exec(choicesBlock)) !== null) {
    if (quoteMatch[1]) {
      models.push(quoteMatch[1]);
    }
  }

  return models;
};

const parseStrategies: Record<string, (output: string) => string[]> = {
  'choices-flag': parseChoicesFlag
};

/**
 * Discover available models for a provider by running its discovery command.
 * Returns the list of model names, or `null` if discovery is unavailable or fails.
 */
export const discoverModels = async (
  provider: ProviderConfig,
  executor: CommandExecutor = defaultExecutor
): Promise<string[] | null> => {
  // If static supportedModels is declared, use it directly
  if (provider.supportedModels && provider.supportedModels.length > 0) {
    return provider.supportedModels;
  }

  const discovery = provider.modelDiscovery;
  if (!discovery) {
    return null;
  }

  return discoverModelsFromConfig(discovery, executor);
};

/**
 * Run model discovery using the provided config.
 */
export const discoverModelsFromConfig = async (
  config: ModelDiscoveryConfig,
  executor: CommandExecutor = defaultExecutor
): Promise<string[] | null> => {
  const parseFn = parseStrategies[config.parseStrategy];
  if (!parseFn) {
    return null;
  }

  try {
    const { stdout, stderr } = await executor(config.command, config.args, {
      timeout: DISCOVERY_TIMEOUT_MS
    });
    const output = stdout + stderr;
    const models = parseFn(output);
    return models.length > 0 ? models : null;
  } catch {
    // Command not found, timeout, or other execution error — skip validation gracefully
    return null;
  }
};

/**
 * Compute the Levenshtein distance between two strings.
 */
export const levenshteinDistance = (a: string, b: string): number => {
  const la = a.length;
  const lb = b.length;

  if (la === 0) return lb;
  if (lb === 0) return la;

  // Use single-row DP for space efficiency
  let prev = Array.from({ length: lb + 1 }, (_, i) => i);

  for (let i = 1; i <= la; i++) {
    const curr = [i];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,          // insertion
        prev[j]! + 1,              // deletion
        prev[j - 1]! + cost        // substitution
      );
    }
    prev = curr;
  }

  return prev[lb]!;
};

/**
 * Find the closest matching model from a list of valid models.
 * Returns the best match if the similarity is within a reasonable threshold.
 */
export const findClosestModel = (
  invalidModel: string,
  validModels: string[]
): string | null => {
  if (validModels.length === 0) {
    return null;
  }

  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const model of validModels) {
    const distance = levenshteinDistance(
      invalidModel.toLowerCase(),
      model.toLowerCase()
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = model;
    }
  }

  // Threshold: allow up to 40% of the longer string's length as the max distance
  const maxLen = Math.max(invalidModel.length, bestMatch?.length ?? 0);
  const threshold = Math.max(3, Math.ceil(maxLen * 0.4));

  return bestDistance <= threshold ? bestMatch : null;
};

/**
 * Build a validation error message for an invalid model, including suggestion if available.
 */
export const buildModelValidationError = (
  model: string,
  providerName: string,
  validModels: string[]
): string => {
  const closest = findClosestModel(model, validModels);
  const suggestion = closest
    ? ` Did you mean "${closest}"?`
    : '';
  const modelList = validModels.map((m) => `  - ${m}`).join('\n');
  return `Invalid model "${model}" for provider "${providerName}".${suggestion}\nValid models:\n${modelList}`;
};
