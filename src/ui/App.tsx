import React, { useState, useCallback, useEffect } from 'react';
import { Box, useApp, useInput } from 'ink';
import type { ArenaProvider, AgentState } from '../monitor/types.js';
import { StatusBar } from './StatusBar.js';
import { AgentTabs } from './AgentTabs.js';
import { Dashboard } from './Dashboard.js';
import { AgentPanel } from './AgentPanel.js';

interface AppProps {
  provider: ArenaProvider;
}

type ViewMode = 'dashboard' | 'detail' | 'interactive';

export function App({ provider }: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [agents, setAgents] = useState<AgentState[]>(() => provider.getStatus().agents);

  // Keep agent list updated
  useEffect(() => {
    const update = () => setAgents(provider.getStatus().agents);
    const interval = setInterval(update, 1000);
    provider.on('status-changed', update);
    return () => {
      clearInterval(interval);
      provider.removeListener('status-changed', update);
    };
  }, [provider]);

  const selectedAgent = agents[selectedIndex];

  useInput((input, key) => {
    if (viewMode === 'interactive') return; // AgentPanel handles input

    // Quit
    if (input === 'q') {
      provider.shutdown().then(() => exit());
      return;
    }

    // Toggle dashboard/detail
    if (input === 'd') {
      setViewMode(prev => prev === 'dashboard' ? 'detail' : 'dashboard');
      return;
    }

    // Tab to next agent
    if (key.tab) {
      setSelectedIndex(prev => (prev + 1) % agents.length);
      if (viewMode === 'dashboard') setViewMode('detail');
      return;
    }

    // Number keys to jump to agent
    const num = parseInt(input, 10);
    if (num >= 1 && num <= agents.length) {
      setSelectedIndex(num - 1);
      if (viewMode === 'dashboard') setViewMode('detail');
      return;
    }

    // Dashboard navigation
    if (viewMode === 'dashboard') {
      if (key.upArrow) {
        setSelectedIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedIndex(prev => Math.min(agents.length - 1, prev + 1));
        return;
      }
      if (key.return) {
        setViewMode('detail');
        return;
      }
    }

    // Detail view
    if (viewMode === 'detail') {
      if (input === 'i' && selectedAgent?.status === 'running') {
        setViewMode('interactive');
        return;
      }
      if (input === 'k' && selectedAgent) {
        provider.killAgent(selectedAgent.variantName);
        return;
      }
      if (input === 'r' && selectedAgent) {
        provider.restartAgent(selectedAgent.variantName);
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Tab bar (shown in detail/interactive modes) */}
      {viewMode !== 'dashboard' && (
        <AgentTabs agents={agents} selectedIndex={selectedIndex} />
      )}

      {/* Main content */}
      <Box flexGrow={1}>
        {viewMode === 'dashboard' ? (
          <Dashboard agents={agents} selectedIndex={selectedIndex} />
        ) : (
          selectedAgent && (
            <AgentPanel
              provider={provider}
              variantName={selectedAgent.variantName}
              isInteractive={viewMode === 'interactive'}
              onExitInteractive={() => setViewMode('detail')}
              onEnterInteractive={() => setViewMode('interactive')}
            />
          )
        )}
      </Box>

      {/* Status bar */}
      <StatusBar
        agents={agents}
        viewMode={viewMode}
        selectedAgent={selectedAgent?.variantName}
      />
    </Box>
  );
}
