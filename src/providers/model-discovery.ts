import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ModelDiscoveryConfig, ProviderConfig } from '../domain/types';

const execFileAsync = promisify(execFile);

const DISCOVERY_TIMEOUT_MS = 30_000;

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
  // Use indexOf to locate the choices block, avoiding regex backtracking entirely.
  const modelIdx = output.search(/--model\b/i);
  if (modelIdx === -1) {
    return [];
  }

  const afterModel = output.substring(modelIdx);
  const choicesIdx = afterModel.search(/\(choices:/i);
  if (choicesIdx === -1) {
    return [];
  }

  const afterChoicesLabel = afterModel.substring(choicesIdx + '(choices:'.length);
  const closingIdx = afterChoicesLabel.indexOf(')');
  if (closingIdx === -1) {
    return [];
  }

  const choicesBlock = afterChoicesLabel.substring(0, closingIdx);
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

/**
 * Parse models from plain-text output where each line is a model name.
 * Filters out empty lines and lines that don't look like model identifiers.
 */
export const parseModelList = (output: string): string[] => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && /^[a-z0-9][\w.:-]*$/i.test(line));
};

const parseStrategies: Record<string, (output: string) => string[]> = {
  'choices-flag': parseChoicesFlag,
  'prompt-models': parseModelList
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
    const output = [stdout, stderr].filter(Boolean).join('\n');
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

const normalizeModelToken = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find the closest matching model using normalized Levenshtein distance
 * with a substring bonus (e.g. "gemini-3-pro" matches "gemini-3-pro-preview").
 */
export const findClosestModel = (
  invalidModel: string,
  validModels: string[]
): string | null => {
  if (validModels.length === 0) {
    return null;
  }

  const normalizedRequested = normalizeModelToken(invalidModel);
  if (!normalizedRequested) {
    return null;
  }

  let bestMatch: { model: string; score: number } | undefined;

  for (const model of validModels) {
    const normalizedCandidate = normalizeModelToken(model);
    const longestLength = Math.max(normalizedRequested.length, normalizedCandidate.length);
    if (longestLength === 0) {
      continue;
    }

    let score = levenshteinDistance(normalizedRequested, normalizedCandidate) / longestLength;
    // Substring bonus: if one model name contains the other, boost the score
    if (
      normalizedCandidate.includes(normalizedRequested)
      || normalizedRequested.includes(normalizedCandidate)
    ) {
      score -= 0.2;
    }

    if (!bestMatch || score < bestMatch.score) {
      bestMatch = { model, score };
    }
  }

  return bestMatch && bestMatch.score <= 0.45 ? bestMatch.model : null;
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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Detect whether agent output indicates an invalid model error.
 * Uses keyword matching plus model name context to avoid false positives.
 */
export const looksLikeInvalidModelError = (
  output: string,
  requestedModel: string
): boolean => {
  const normalizedOutput = output.toLowerCase();
  const normalizedModel = requestedModel.toLowerCase();
  const mentionsModel = normalizedOutput.includes(normalizedModel);
  const invalidModelPattern = /(invalid|unknown|unsupported|unrecognized|not a valid|no such model|must be one of|available models|did you mean)/i;
  const modelContextPattern = new RegExp(
    `model[^\\n]{0,80}${escapeRegExp(normalizedModel)}|${escapeRegExp(normalizedModel)}[^\\n]{0,80}model`,
    'i'
  );

  return invalidModelPattern.test(output) && (mentionsModel || modelContextPattern.test(normalizedOutput));
};
