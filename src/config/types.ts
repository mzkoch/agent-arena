import { z } from 'zod';
import { AgentProviderSchema } from '../providers/types.js';

export const VariantSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens'),
  provider: z.string().default('copilot-cli'),
  model: z.string(),
  techStack: z.string(),
  designPhilosophy: z.string(),
  branch: z.string().optional(),
});

export const ArenaConfigSchema = z.object({
  repoName: z.string().min(1),
  maxContinues: z.number().int().positive().default(50),
  agentTimeoutMs: z.number().int().positive().optional(),
  worktreeDir: z.string().optional(),
  providers: z.record(z.string(), AgentProviderSchema).optional(),
  variants: z.array(VariantSchema).min(1),
}).refine(
  (config) => {
    const names = config.variants.map(v => v.name);
    return new Set(names).size === names.length;
  },
  { message: 'Variant names must be unique' }
);

export type Variant = z.infer<typeof VariantSchema>;
export type ArenaConfig = z.infer<typeof ArenaConfigSchema>;
