import React from 'react';
import { Box, Text } from 'ink';
import type { AgentState } from '../monitor/types.js';

interface AgentTabsProps {
  agents: AgentState[];
  selectedIndex: number;
}

const statusColors: Record<string, string> = {
  pending: 'gray',
  running: 'green',
  idle: 'yellow',
  completed: 'cyan',
  failed: 'red',
  killed: 'red',
};

export function AgentTabs({ agents, selectedIndex }: AgentTabsProps): React.JSX.Element {
  return (
    <Box flexDirection="row" gap={1}>
      {agents.map((agent, i) => {
        const isSelected = i === selectedIndex;
        const color = statusColors[agent.status] ?? 'white';
        return (
          <Box key={agent.variantName} paddingX={1}>
            <Text
              bold={isSelected}
              underline={isSelected}
              color={color}
            >
              {agent.variantName}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}
