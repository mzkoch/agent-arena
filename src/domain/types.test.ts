import { describe, expect, it } from 'vitest';
import { isTerminalStatus } from './types';

describe('isTerminalStatus', () => {
  it.each(['completed', 'failed', 'killed'] as const)(
    'returns true for terminal status "%s"',
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    }
  );

  it.each(['pending', 'running', 'idle', 'verifying'] as const)(
    'returns false for non-terminal status "%s"',
    (status) => {
      expect(isTerminalStatus(status)).toBe(false);
    }
  );
});
