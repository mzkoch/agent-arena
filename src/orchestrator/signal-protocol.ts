import { z } from 'zod';

/** Envelope format: <<<ARENA_SIGNAL:{"status":"done"}>>> */
const SIGNAL_PREFIX = '<<<ARENA_SIGNAL:';
const COMMAND_PREFIX = '<<<ARENA_COMMAND:';
const ENVELOPE_SUFFIX = '>>>';

const signalPayloadSchema = z.object({
  status: z.enum(['done', 'continue'])
});

export type SignalPayload = z.infer<typeof signalPayloadSchema>;

export interface CommandPayload {
  action: 'continue';
  reason: string;
}

export interface ParsedSignal {
  status: 'done' | 'continue';
}

/**
 * Extract and parse a signal envelope from text.
 * Returns null if no valid envelope is found.
 */
export const parseSignalEnvelope = (text: string): ParsedSignal | null => {
  const match = extractEnvelopePayload(text, SIGNAL_PREFIX);
  if (!match) return null;

  const result = signalPayloadSchema.safeParse(match);
  return result.success ? { status: result.data.status } : null;
};

/**
 * Format a command envelope for sending to an agent's PTY stdin.
 */
export const formatCommandEnvelope = (payload: CommandPayload): string => {
  return `${COMMAND_PREFIX}${JSON.stringify(payload)}${ENVELOPE_SUFFIX}`;
};

/**
 * Format a signal envelope (for testing or agent output simulation).
 */
export const formatSignalEnvelope = (payload: SignalPayload): string => {
  return `${SIGNAL_PREFIX}${JSON.stringify(payload)}${ENVELOPE_SUFFIX}`;
};

function extractEnvelopePayload(text: string, prefix: string): unknown {
  const startIdx = text.indexOf(prefix);
  if (startIdx === -1) return null;

  const jsonStart = startIdx + prefix.length;
  const endIdx = text.indexOf(ENVELOPE_SUFFIX, jsonStart);
  if (endIdx === -1) return null;

  const jsonStr = text.slice(jsonStart, endIdx);
  try {
    return JSON.parse(jsonStr) as unknown;
  } catch {
    return null;
  }
}
