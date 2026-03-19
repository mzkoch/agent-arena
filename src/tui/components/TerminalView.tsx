import React from 'react';
import { Text } from 'ink';
import type { TerminalSnapshot } from '../../terminal/types';

export const getVisibleLines = (
  snapshot: TerminalSnapshot,
  scrollOffset: number,
  maxLines: number
): string[] => {
  const { lines } = snapshot;
  const safeOffset = Math.max(0, scrollOffset);
  const end = lines.length - safeOffset;
  const start = Math.max(0, end - maxLines);
  return lines.slice(start, Math.max(start, end));
};

interface TerminalViewProps {
  snapshot: TerminalSnapshot;
  scrollOffset: number;
  maxLines: number;
}

export const TerminalView = ({
  snapshot,
  scrollOffset,
  maxLines,
}: TerminalViewProps): React.JSX.Element => {
  const visibleLines = getVisibleLines(snapshot, scrollOffset, maxLines);

  if (visibleLines.length === 0) {
    return <Text dimColor>No output yet.</Text>;
  }

  return (
    <>
      {visibleLines.map((line, index) => (
        <Text key={index}>{line}</Text>
      ))}
    </>
  );
};
