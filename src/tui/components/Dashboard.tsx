import React from 'react';
import { Box, Text } from 'ink';
import type { AgentSnapshot } from '../../domain/types';
import { formatElapsed } from '../../utils/format';
import { StatusIndicator } from './StatusIndicator';

const getElapsed = (agent: AgentSnapshot, now: number): string => {
  if (agent.startedAt && !agent.completedAt && (agent.status === 'running' || agent.status === 'idle')) {
    return formatElapsed(now - new Date(agent.startedAt).getTime());
  }

  return formatElapsed(agent.elapsedMs);
};

interface DashboardProps {
  agents: AgentSnapshot[];
  selectedIndex: number;
  now: number;
}

export const Dashboard = ({ agents, selectedIndex, now }: DashboardProps): React.JSX.Element => (
  <Box flexDirection="column">
    <Text bold>Agent Arena Dashboard</Text>
    <Text dimColor>Name                  Provider       Model                 Status   Elapsed</Text>
    {agents.map((agent, index) => (
      <Text key={agent.name} inverse={index === selectedIndex}>
        {index === selectedIndex ? '>' : ' '} {agent.name.padEnd(20)} {agent.provider.padEnd(13)}{' '}
        {agent.model.padEnd(20)} <StatusIndicator status={agent.status} /> {agent.status.padEnd(8)}{' '}
        {getElapsed(agent, now)}
      </Text>
    ))}
  </Box>
);
