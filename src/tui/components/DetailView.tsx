import React from 'react';
import { Box, Text } from 'ink';
import type { AgentSnapshot } from '../../domain/types';
import type { ArenaControllerCapabilities } from '../controller';
import { formatElapsed } from '../../utils/format';
import { AgentTabs } from './AgentTabs';
import { StatusIndicator } from './StatusIndicator';
import { TerminalView } from './TerminalView';

interface DetailViewProps {
  agents: AgentSnapshot[];
  selectedIndex: number;
  scrollOffset: number;
  interactive: boolean;
  now: number;
  capabilities: ArenaControllerCapabilities;
}

export const DetailView = ({
  agents,
  selectedIndex,
  scrollOffset,
  interactive,
  now,
  capabilities
}: DetailViewProps): React.JSX.Element => {
  const agent = agents[selectedIndex];
  const elapsed = agent?.startedAt && !agent?.completedAt
    ? formatElapsed(now - new Date(agent.startedAt).getTime())
    : formatElapsed(agent?.elapsedMs ?? 0);

  const footerParts = ['Tab next agent', 'd toggle view'];
  if (capabilities.canSendInput) footerParts.push('i interactive');
  if (capabilities.canKill) footerParts.push('k kill');
  if (capabilities.canRestart) footerParts.push('r restart');
  footerParts.push(capabilities.mode === 'monitor' ? 'q exit monitor' : 'q quit');
  const footer = footerParts.join(' | ');

  return (
    <Box flexDirection="column">
      <AgentTabs agents={agents} selectedIndex={selectedIndex} />
      {agent ? (
        <>
          <Text>
            <StatusIndicator status={agent.status} /> {agent.name} | {agent.provider} | {agent.model} |{' '}
            {elapsed} | checks: {agent.checksPerformed} | {interactive ? 'interactive' : 'view'}
          </Text>
          <Text dimColor>{agent.worktreePath}</Text>
          <Box borderStyle="round" flexDirection="column" paddingX={1}>
            <TerminalView snapshot={agent.terminal} scrollOffset={scrollOffset} maxLines={24} />
          </Box>
          <Text dimColor>{footer}</Text>
        </>
      ) : (
        <Text>No agents available.</Text>
      )}
    </Box>
  );
};
