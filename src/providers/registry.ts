import type { ArenaConfig, ProviderConfig, VariantConfig } from '../domain/types';
import { BUILTIN_PROVIDERS } from './builtins';

export class ProviderRegistry {
  private readonly providers: Map<string, ProviderConfig>;

  public constructor(customProviders: Record<string, ProviderConfig> = {}) {
    this.providers = new Map<string, ProviderConfig>();
    const merged = {
      ...BUILTIN_PROVIDERS,
      ...customProviders
    };

    for (const [name, provider] of Object.entries(merged)) {
      this.providers.set(name, provider);
    }
  }

  public get(name: string): ProviderConfig {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown provider "${name}". Define it in arena.json providers.`);
    }

    return provider;
  }

  public list(): string[] {
    return [...this.providers.keys()].sort();
  }
}

export interface ProviderCommand {
  command: string;
  args: string[];
  stdinPayload?: string;
}

export const buildProviderCommand = (
  provider: ProviderConfig,
  variant: VariantConfig,
  prompt: string,
  maxContinues: number
): ProviderCommand => {
  const args = [...provider.baseArgs];

  if (provider.modelFlag) {
    args.push(provider.modelFlag, variant.model);
  }

  if (provider.maxContinuesFlag) {
    args.push(provider.maxContinuesFlag, String(maxContinues));
  }

  switch (provider.promptDelivery) {
    case 'flag':
      args.push(provider.promptFlag!, prompt);
      return { command: provider.command, args };
    case 'positional':
      args.push(prompt);
      return { command: provider.command, args };
    case 'stdin':
      return {
        command: provider.command,
        args,
        stdinPayload: `${prompt}\n`
      };
    default:
      return { command: provider.command, args };
  }
};

export const createProviderRegistry = (config: ArenaConfig): ProviderRegistry =>
  new ProviderRegistry(config.providers);
