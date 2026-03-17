import React from 'react';
import { Text } from 'ink';
import type { AgentStatus } from '../../domain/types';

const STATUS_META: Record<AgentStatus, { icon: string; color: Parameters<typeof Text>[0]['color'] }> = {
  pending: { icon: '○', color: 'gray' },
  running: { icon: '●', color: 'green' },
  idle: { icon: '◐', color: 'yellow' },
  completed: { icon: '✓', color: 'cyan' },
  failed: { icon: '✗', color: 'red' },
  killed: { icon: '✗', color: 'red' }
};

export const StatusIndicator = ({ status }: { status: AgentStatus }): React.JSX.Element => {
  const meta = STATUS_META[status];
  return <Text color={meta.color}>{meta.icon}</Text>;
};
