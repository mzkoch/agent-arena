import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '../monitor/types.js';
import { formatElapsed } from '../utils/process.js';

interface DashboardProps {
  agents: AgentState[];
  selectedIndex: number;
}

const statusIcons: Record<string, string> = {
  pending: '○',
  running: '●',
  idle: '◐',
  completed: '✓',
  failed: '✗',
  killed: '✗',
};

const statusColors: Record<string, string> = {
  pending: 'gray',
  running: 'green',
  idle: 'yellow',
  completed: 'cyan',
  failed: 'red',
  killed: 'red',
};

export function Dashboard({ agents, selectedIndex }: DashboardProps): React.JSX.Element {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="white">Agent Arena — Dashboard</Text>
      </Box>
      {/* Header */}
      <Box gap={2}>
        <Box width={3}><Text dimColor> </Text></Box>
        <Box width={20}><Text bold dimColor>Name</Text></Box>
        <Box width={14}><Text bold dimColor>Provider</Text></Box>
        <Box width={22}><Text bold dimColor>Model</Text></Box>
        <Box width={12}><Text bold dimColor>Status</Text></Box>
        <Box width={10}><Text bold dimColor>Elapsed</Text></Box>
      </Box>
      {/* Rows */}
      {agents.map((agent, i) => {
        const isSelected = i === selectedIndex;
        const color = statusColors[agent.status] ?? 'white';
        const icon = statusIcons[agent.status] ?? '?';
        const elapsed = agent.startedAt
          ? formatElapsed(Date.now() - new Date(agent.startedAt).getTime())
          : '—';

        return (
          <Box key={agent.variantName} gap={2}>
            <Box width={3}>
              <Text color={isSelected ? 'yellow' : 'white'}>{isSelected ? '›' : ' '}</Text>
            </Box>
            <Box width={20}>
              <Text bold={isSelected}>{agent.variantName}</Text>
            </Box>
            <Box width={14}>
              <Text dimColor>{agent.provider}</Text>
            </Box>
            <Box width={22}>
              <Text dimColor>{agent.model}</Text>
            </Box>
            <Box width={12}>
              <Text color={color}>{icon} {agent.status}</Text>
            </Box>
            <Box width={10}>
              <Text>{elapsed}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
