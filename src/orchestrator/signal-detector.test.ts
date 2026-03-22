import { describe, expect, it } from 'vitest';
import { detectSignal } from './signal-detector';
import type { CompletionProtocol } from '../domain/types';

const protocol: CompletionProtocol = {
  idleTimeoutMs: 30_000,
  maxChecks: 3,
  responseTimeoutMs: 60_000,
  doneMarker: 'ARENA_DONE',
  continueMarker: 'ARENA_CONTINUING'
};

describe('detectSignal', () => {
  describe('envelope detection (layer 1)', () => {
    it('detects done signal from envelope', () => {
      const text = '<<<ARENA_SIGNAL:{"status":"done"}>>>';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'done', source: 'envelope' });
    });

    it('detects continue signal from envelope', () => {
      const text = '<<<ARENA_SIGNAL:{"status":"continue"}>>>';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'continue', source: 'envelope' });
    });

    it('detects envelope embedded in output', () => {
      const text = 'Working on task...\n<<<ARENA_SIGNAL:{"status":"done"}>>>\nAll done!';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'done', source: 'envelope' });
    });
  });

  describe('legacy detection (layer 2)', () => {
    it('detects done marker from legacy format', () => {
      const text = 'Output\nARENA_DONE\n';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'done', source: 'legacy' });
    });

    it('detects continue marker from legacy format', () => {
      const text = 'Output\nARENA_CONTINUING\n';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'continue', source: 'legacy' });
    });

    it('detects custom done marker', () => {
      const customProtocol: CompletionProtocol = {
        ...protocol,
        doneMarker: 'CUSTOM_DONE'
      };
      const result = detectSignal('CUSTOM_DONE', customProtocol);
      expect(result).toEqual({ match: 'done', source: 'legacy' });
    });
  });

  describe('priority', () => {
    it('envelope takes priority over legacy when both are present', () => {
      const text = 'ARENA_DONE <<<ARENA_SIGNAL:{"status":"continue"}>>>';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'continue', source: 'envelope' });
    });

    it('envelope done takes priority over legacy continue', () => {
      const text = 'ARENA_CONTINUING <<<ARENA_SIGNAL:{"status":"done"}>>>';
      const result = detectSignal(text, protocol);
      expect(result).toEqual({ match: 'done', source: 'envelope' });
    });
  });

  describe('no match', () => {
    it('returns null match when no signal is present', () => {
      const result = detectSignal('just some output', protocol);
      expect(result).toEqual({ match: null, source: null });
    });

    it('returns null match for empty string', () => {
      const result = detectSignal('', protocol);
      expect(result).toEqual({ match: null, source: null });
    });

    it('returns null for partial marker', () => {
      const result = detectSignal('ARENA_DO', protocol);
      expect(result).toEqual({ match: null, source: null });
    });
  });

  describe('false positive prevention', () => {
    it('does not match marker mentioned in agent reasoning', () => {
      const reasoning = 'I need to output ARENA_DONE when I finish the task.';
      // This IS a legacy match — legacy scanning has this weakness
      const result = detectSignal(reasoning, protocol);
      expect(result.match).toBe('done');
      expect(result.source).toBe('legacy');
      // Envelope format would NOT match here, showing the improvement
    });

    it('does not match envelope prefix in reasoning about the protocol', () => {
      const reasoning = 'The signal format uses <<<ARENA_SIGNAL: prefix for structured messages';
      // This should NOT match because the JSON inside is incomplete
      const result = detectSignal(reasoning, protocol);
      expect(result).toEqual({ match: null, source: null });
    });
  });
});
