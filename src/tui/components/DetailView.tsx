import React from 'react';
import { Box, Text } from 'ink';
import type { AgentSnapshot } from '../../domain/types';
import { formatElapsed } from '../../utils/format';
import { AgentTabs } from './AgentTabs';
import { StatusIndicator } from './StatusIndicator';

const getVisibleLines = (
  outputLines: string[],
  scrollOffset: number,
  maxLines: number
): string[] => {
  const safeOffset = Math.max(0, scrollOffset);
  const end = outputLines.length - safeOffset;
  const start = Math.max(0, end - maxLines);
  return outputLines.slice(start, Math.max(start, end));
};

interface DetailViewProps {
  agents: AgentSnapshot[];
  selectedIndex: number;
  scrollOffset: number;
  interactive: boolean;
  now: number;
}

export const DetailView = ({
  agents,
  selectedIndex,
  scrollOffset,
  interactive,
  now
}: DetailViewProps): React.JSX.Element => {
  const agent = agents[selectedIndex];
  const outputLines = agent ? getVisibleLines(agent.outputLines, scrollOffset, 24) : [];
  const elapsed = agent?.startedAt && !agent?.completedAt
    ? formatElapsed(now - new Date(agent.startedAt).getTime())
    : formatElapsed(agent?.elapsedMs ?? 0);

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
            {outputLines.length === 0 ? (
              <Text dimColor>No output yet.</Text>
            ) : (
              outputLines.map((line, index) => <Text key={`${index}-${line}`}>{line}</Text>)
            )}
          </Box>
          <Text dimColor>
            Tab next agent | d toggle view | i interactive | k kill | r restart | q quit
          </Text>
        </>
      ) : (
        <Text>No agents available.</Text>
      )}
    </Box>
  );
};
