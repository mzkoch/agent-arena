import type { CompletionProtocol } from '../domain/types';
import { parseSignalEnvelope } from './signal-protocol';

export type SignalMatch = 'done' | 'continue' | null;

export interface SignalDetectionResult {
  match: SignalMatch;
  source: 'envelope' | 'legacy' | null;
}

/**
 * Two-layer signal detection:
 * 1. Try structured envelope detection first (<<<ARENA_SIGNAL:...>>>)
 * 2. Fall back to legacy string.includes() marker scanning
 *
 * Envelope takes priority if both are present.
 */
export const detectSignal = (
  plainText: string,
  protocol: CompletionProtocol
): SignalDetectionResult => {
  // Layer 1: Envelope detection
  const envelope = parseSignalEnvelope(plainText);
  if (envelope) {
    return { match: envelope.status, source: 'envelope' };
  }

  // Layer 2: Legacy marker scanning
  if (plainText.includes(protocol.doneMarker)) {
    return { match: 'done', source: 'legacy' };
  }
  if (plainText.includes(protocol.continueMarker)) {
    return { match: 'continue', source: 'legacy' };
  }

  return { match: null, source: null };
};
