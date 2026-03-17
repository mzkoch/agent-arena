import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '../monitor/types.js';

interface StatusBarProps {
  agents: AgentState[];
  viewMode: 'dashboard' | 'detail' | 'interactive';
  selectedAgent?: string;
}

export function StatusBar({ agents, viewMode, selectedAgent }: StatusBarProps): React.JSX.Element {
  const running = agents.filter(a => a.status === 'running').length;
  const completed = agents.filter(a => a.status === 'completed').length;
  const failed = agents.filter(a => a.status === 'failed' || a.status === 'killed').length;

  const keyHints: string[] = [];
  switch (viewMode) {
    case 'dashboard':
      keyHints.push('↑↓:Navigate', 'Enter:Select', 'Tab:Next', 'd:Detail', 'q:Quit');
      break;
    case 'detail':
      keyHints.push('Tab:Next', '1-9:Jump', 'd:Dashboard', 'i:Interactive', 'k:Kill', 'r:Restart', 'q:Quit');
      break;
    case 'interactive':
      keyHints.push('Esc:Exit Interactive', 'Ctrl+C:Interrupt');
      break;
  }

  return (
    <Box flexDirection="row" justifyContent="space-between" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text>
        <Text color="green">● {running} running</Text>
        {'  '}
        <Text color="cyan">✓ {completed} done</Text>
        {'  '}
        <Text color="red">✗ {failed} failed</Text>
        {selectedAgent && (
          <>{'  '}<Text color="yellow">→ {selectedAgent}</Text></>
        )}
      </Text>
      <Text dimColor>{keyHints.join(' | ')}</Text>
    </Box>
  );
}
