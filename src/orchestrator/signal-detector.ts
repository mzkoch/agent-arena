import { parseSignalEnvelope } from './signal-protocol';

export type SignalMatch = 'done' | 'continue' | null;

/**
 * Envelope-only signal detection.
 * Parses the <<<ARENA_SIGNAL:...>>> envelope format from plain text.
 */
export const detectSignal = (plainText: string): SignalMatch => {
  const envelope = parseSignalEnvelope(plainText);
  return envelope ? envelope.status : null;
};
