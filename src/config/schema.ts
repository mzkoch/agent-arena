import { z } from 'zod';

const defaultCompletionProtocol = {
  idleTimeoutMs: 30_000,
  maxChecks: 3,
  responseTimeoutMs: 60_000,
  doneMarker: 'ARENA_DONE',
  continueMarker: 'ARENA_CONTINUING'
} as const;

const completionProtocolSchema = z.object({
  idleTimeoutMs: z.number().int().positive().default(30_000),
  maxChecks: z.number().int().positive().default(3),
  responseTimeoutMs: z.number().int().positive().default(60_000),
  doneMarker: z.string().min(1).default('ARENA_DONE'),
  continueMarker: z.string().min(1).default('ARENA_CONTINUING')
});

const trustedFoldersSchema = z.object({
  configFile: z.string().min(1),
  jsonKey: z.string().min(1)
});

export const providerConfigSchema = z
  .object({
    command: z.string().min(1),
    baseArgs: z.array(z.string()).default([]),
    modelFlag: z.string().min(1).optional(),
    promptDelivery: z.enum(['positional', 'flag', 'stdin']),
    promptFlag: z.string().min(1).optional(),
    maxContinuesFlag: z.string().min(1).optional(),
    exitCommand: z.string().min(1),
    completionProtocol: completionProtocolSchema.default(defaultCompletionProtocol),
    trustedFolders: trustedFoldersSchema.optional()
  })
  .superRefine((value, ctx) => {
    if (value.promptDelivery === 'flag' && !value.promptFlag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promptFlag'],
        message: 'promptFlag is required when promptDelivery is "flag".'
      });
    }
  });

export const variantConfigSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'Variant names must be lowercase alphanumeric with hyphens only.'),
  provider: z.string().min(1).default('copilot-cli'),
  model: z.string().min(1),
  techStack: z.string().min(1),
  designPhilosophy: z.string().min(1),
  branch: z.string().min(1).optional()
});

export const arenaConfigSchema = z
  .object({
    repoName: z.string().min(1).optional(),
    maxContinues: z.number().int().positive().default(50),
    agentTimeoutMs: z.number().int().positive().default(3_600_000),
    providers: z.record(z.string(), providerConfigSchema).default({}),
    variants: z.array(variantConfigSchema).min(1, 'At least one variant is required.')
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    for (const [index, variant] of value.variants.entries()) {
      if (seen.has(variant.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['variants', index, 'name'],
          message: `Variant name "${variant.name}" is duplicated.`
        });
      }
      seen.add(variant.name);
    }
  });

export type ArenaConfigInput = z.input<typeof arenaConfigSchema>;
