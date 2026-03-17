import { AgentProviderSchema, type AgentProvider } from './types.js';
import { copilotCliProvider } from './copilot-cli.js';
import { claudeCodeProvider } from './claude-code.js';

const builtInProviders: Record<string, AgentProvider> = {
  'copilot-cli': copilotCliProvider,
  'claude-code': claudeCodeProvider,
};

/**
 * Build a provider registry by merging built-in providers with user-defined overrides.
 * User providers override built-ins with the same name, or add new ones.
 */
export function buildProviderRegistry(
  userProviders?: Record<string, unknown>,
): Record<string, AgentProvider> {
  const registry = { ...builtInProviders };

  if (userProviders) {
    for (const [name, raw] of Object.entries(userProviders)) {
      registry[name] = AgentProviderSchema.parse(raw);
    }
  }

  return registry;
}

/**
 * Get a provider by name from a registry.
 * Throws if the provider is not found.
 */
export function getProvider(
  registry: Record<string, AgentProvider>,
  name: string,
): AgentProvider {
  const provider = registry[name];
  if (!provider) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown agent provider "${name}". Available: ${available}`);
  }
  return provider;
}
