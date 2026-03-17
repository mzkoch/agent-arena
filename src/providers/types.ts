import { z } from 'zod';

// Zod schema for the completion protocol configuration
export const CompletionProtocolSchema = z.object({
  idleTimeoutMs: z.number().default(30000),
  maxChecks: z.number().default(3),
  responseTimeoutMs: z.number().default(60000),
  doneMarker: z.string().default('ARENA_DONE'),
  continueMarker: z.string().default('ARENA_CONTINUING'),
});

// Zod schema for trusted folders configuration (provider-specific setup)
export const TrustedFoldersSchema = z.object({
  configFile: z.string(),   // e.g., "~/.copilot/config.json"
  jsonKey: z.string(),       // e.g., "trusted_folders"
});

// Zod schema for the agent provider
export const AgentProviderSchema = z.object({
  command: z.string(),                                          // e.g., "copilot", "claude"
  baseArgs: z.array(z.string()).default([]),                    // e.g., ["--autopilot", "--yolo"]
  modelFlag: z.string(),                                        // e.g., "--model"
  promptDelivery: z.enum(['flag', 'positional', 'stdin']),      // how initial prompt is delivered
  promptFlag: z.string().optional(),                            // e.g., "-i" (only for "flag" delivery)
  maxContinuesFlag: z.string().optional(),                      // e.g., "--max-autopilot-continues"
  exitCommand: z.string(),                                      // e.g., "/exit"
  completionProtocol: CompletionProtocolSchema.default({}),
  trustedFolders: TrustedFoldersSchema.optional(),
});

// TypeScript types inferred from Zod schemas
export type CompletionProtocol = z.infer<typeof CompletionProtocolSchema>;
export type TrustedFolders = z.infer<typeof TrustedFoldersSchema>;
export type AgentProvider = z.infer<typeof AgentProviderSchema>;
