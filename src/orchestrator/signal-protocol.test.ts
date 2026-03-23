import { describe, expect, it } from 'vitest';
import {
  parseSignalEnvelope,
  formatSignalEnvelope,
  formatCommandEnvelope,
  type SignalPayload,
  type CommandPayload
} from './signal-protocol';

describe('parseSignalEnvelope', () => {
  it('parses a valid done signal envelope', () => {
    const text = '<<<ARENA_SIGNAL:{"status":"done"}>>>';
    const result = parseSignalEnvelope(text);
    expect(result).toEqual({ status: 'done' });
  });

  it('parses a valid continue signal envelope', () => {
    const text = '<<<ARENA_SIGNAL:{"status":"continue"}>>>';
    const result = parseSignalEnvelope(text);
    expect(result).toEqual({ status: 'continue' });
  });

  it('parses envelope embedded in surrounding text', () => {
    const text = 'Some agent output\n<<<ARENA_SIGNAL:{"status":"done"}>>>\nMore output';
    const result = parseSignalEnvelope(text);
    expect(result).toEqual({ status: 'done' });
  });

  it('returns null for plain text without envelope', () => {
    expect(parseSignalEnvelope('just some text')).toBeNull();
    expect(parseSignalEnvelope('ARENA_DONE')).toBeNull();
    expect(parseSignalEnvelope('')).toBeNull();
  });

  it('returns null for malformed JSON in envelope', () => {
    const text = '<<<ARENA_SIGNAL:{not json}>>>';
    expect(parseSignalEnvelope(text)).toBeNull();
  });

  it('returns null for invalid status value', () => {
    const text = '<<<ARENA_SIGNAL:{"status":"invalid"}>>>';
    expect(parseSignalEnvelope(text)).toBeNull();
  });

  it('returns null for missing closing bracket', () => {
    const text = '<<<ARENA_SIGNAL:{"status":"done"}';
    expect(parseSignalEnvelope(text)).toBeNull();
  });

  it('returns null for missing opening bracket', () => {
    const text = '{"status":"done"}>>>';
    expect(parseSignalEnvelope(text)).toBeNull();
  });

  it('returns null for partial prefix', () => {
    const text = '<<<ARENA_SIG:{"status":"done"}>>>';
    expect(parseSignalEnvelope(text)).toBeNull();
  });

  it('handles envelope appearing in reasoning/thinking output without false positive', () => {
    // The prefix is specific enough that it won't appear in normal agent reasoning
    const reasoning = 'I should output ARENA_DONE when I\'m finished. Let me think about the signal format...';
    expect(parseSignalEnvelope(reasoning)).toBeNull();
  });

  it('parses the first envelope when multiple are present', () => {
    const text = '<<<ARENA_SIGNAL:{"status":"done"}>>> <<<ARENA_SIGNAL:{"status":"continue"}>>>';
    const result = parseSignalEnvelope(text);
    expect(result).toEqual({ status: 'done' });
  });
});

describe('formatSignalEnvelope', () => {
  it('formats a done signal envelope', () => {
    const payload: SignalPayload = { status: 'done' };
    expect(formatSignalEnvelope(payload)).toBe('<<<ARENA_SIGNAL:{"status":"done"}>>>');
  });

  it('formats a continue signal envelope', () => {
    const payload: SignalPayload = { status: 'continue' };
    expect(formatSignalEnvelope(payload)).toBe('<<<ARENA_SIGNAL:{"status":"continue"}>>>');
  });

  it('produces output that parseSignalEnvelope can parse', () => {
    const payload: SignalPayload = { status: 'done' };
    const formatted = formatSignalEnvelope(payload);
    const parsed = parseSignalEnvelope(formatted);
    expect(parsed).toEqual({ status: 'done' });
  });
});

describe('formatCommandEnvelope', () => {
  it('formats a continue command envelope', () => {
    const payload: CommandPayload = { action: 'continue', reason: 'No commits found.' };
    const result = formatCommandEnvelope(payload);
    expect(result).toBe('<<<ARENA_COMMAND:{"action":"continue","reason":"No commits found."}>>>');
  });

  it('handles special characters in reason', () => {
    const payload: CommandPayload = { action: 'continue', reason: 'Fix: line 1\nline 2' };
    const result = formatCommandEnvelope(payload);
    expect(result).toContain('<<<ARENA_COMMAND:');
    expect(result).toContain('>>>');
    // JSON should handle newlines via escaping
    expect(result).toContain('\\n');
  });
});
