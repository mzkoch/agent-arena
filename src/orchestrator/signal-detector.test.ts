import { describe, expect, it } from 'vitest';
import { detectSignal } from './signal-detector';

describe('detectSignal', () => {
  describe('envelope detection', () => {
    it('detects done signal from envelope', () => {
      const text = '<<<ARENA_SIGNAL:{"status":"done"}>>>';
      expect(detectSignal(text)).toBe('done');
    });

    it('detects continue signal from envelope', () => {
      const text = '<<<ARENA_SIGNAL:{"status":"continue"}>>>';
      expect(detectSignal(text)).toBe('continue');
    });

    it('detects envelope embedded in output', () => {
      const text = 'Working on task...\n<<<ARENA_SIGNAL:{"status":"done"}>>>\nAll done!';
      expect(detectSignal(text)).toBe('done');
    });
  });

  describe('no match', () => {
    it('returns null when no signal is present', () => {
      expect(detectSignal('just some output')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(detectSignal('')).toBeNull();
    });

    it('returns null for partial envelope prefix', () => {
      expect(detectSignal('<<<ARENA_SIGNAL:')).toBeNull();
    });
  });

  describe('false positive prevention', () => {
    it('does not match raw marker strings without envelope', () => {
      const reasoning = 'I need to output ARENA_DONE when I finish the task.';
      expect(detectSignal(reasoning)).toBeNull();
    });

    it('does not match envelope prefix in reasoning about the protocol', () => {
      const reasoning = 'The signal format uses <<<ARENA_SIGNAL: prefix for structured messages';
      expect(detectSignal(reasoning)).toBeNull();
    });

    it('does not match malformed envelope JSON', () => {
      const text = '<<<ARENA_SIGNAL:{invalid json}>>>';
      expect(detectSignal(text)).toBeNull();
    });
  });
});
