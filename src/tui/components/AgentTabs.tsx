import React from 'react';
import { Box, Text } from 'ink';
import type { AgentSnapshot } from '../../domain/types';
import { StatusIndicator } from './StatusIndicator';

interface AgentTabsProps {
  agents: AgentSnapshot[];
  selectedIndex: number;
}

export const AgentTabs = ({ agents, selectedIndex }: AgentTabsProps): React.JSX.Element => (
  <Box gap={1} flexWrap="wrap">
    {agents.map((agent, index) => (
      <Box key={agent.name} borderStyle="round" paddingX={1}>
        <Text inverse={index === selectedIndex}>
          <StatusIndicator status={agent.status} /> {agent.name}
        </Text>
      </Box>
    ))}
  </Box>
);
