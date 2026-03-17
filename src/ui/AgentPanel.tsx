import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ArenaProvider } from '../monitor/types.js';

interface AgentPanelProps {
  provider: ArenaProvider;
  variantName: string;
  isInteractive: boolean;
  onExitInteractive: () => void;
  onEnterInteractive: () => void;
}

export function AgentPanel({
  provider,
  variantName,
  isInteractive,
  onExitInteractive,
  onEnterInteractive,
}: AgentPanelProps): React.JSX.Element {
  const [lines, setLines] = useState<string[]>(() => provider.getOutputBuffer(variantName));
  const [inputBuffer, setInputBuffer] = useState('');
  const maxVisibleLines = 30;

  useEffect(() => {
    const handleOutput = (name: string, line: string) => {
      if (name === variantName) {
        setLines(prev => {
          const next = [...prev, line];
          if (next.length > 2000) next.shift();
          return next;
        });
      }
    };

    provider.on('agent-output', handleOutput);
    return () => {
      provider.removeListener('agent-output', handleOutput);
    };
  }, [provider, variantName]);

  // Reset lines when switching agents
  useEffect(() => {
    setLines(provider.getOutputBuffer(variantName));
  }, [variantName, provider]);

  useInput((input, key) => {
    if (isInteractive) {
      if (key.escape) {
        onExitInteractive();
        setInputBuffer('');
        return;
      }
      if (key.return) {
        provider.sendInput(variantName, inputBuffer + '\r');
        setInputBuffer('');
        return;
      }
      if (key.backspace || key.delete) {
        setInputBuffer(prev => prev.slice(0, -1));
        return;
      }
      if (key.ctrl && input === 'c') {
        provider.sendInput(variantName, '\x03');
        return;
      }
      if (key.upArrow) { provider.sendInput(variantName, '\x1b[A'); return; }
      if (key.downArrow) { provider.sendInput(variantName, '\x1b[B'); return; }
      if (key.leftArrow) { provider.sendInput(variantName, '\x1b[D'); return; }
      if (key.rightArrow) { provider.sendInput(variantName, '\x1b[C'); return; }
      if (input && !key.ctrl && !key.meta) {
        setInputBuffer(prev => prev + input);
      }
    }
  });

  const visibleLines = lines.slice(-maxVisibleLines);
  const agent = provider.getStatus().agents.find(a => a.variantName === variantName);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text bold>{variantName}</Text>
        <Text dimColor>
          {agent?.provider} | {agent?.model} | {agent?.status ?? 'unknown'}
        </Text>
      </Box>

      {/* Output */}
      <Box flexDirection="column" flexGrow={1} paddingX={1} borderStyle="single" borderColor="gray">
        {visibleLines.map((line, i) => (
          <Text key={i} wrap="truncate">{line}</Text>
        ))}
        {visibleLines.length === 0 && (
          <Text dimColor>Waiting for output...</Text>
        )}
      </Box>

      {/* Interactive input */}
      {isInteractive && (
        <Box paddingX={1} borderStyle="single" borderColor="yellow">
          <Text color="yellow" bold>INTERACTIVE </Text>
          <Text>› {inputBuffer}</Text>
          <Text color="gray">█</Text>
        </Box>
      )}
    </Box>
  );
}
