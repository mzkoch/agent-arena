import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ArenaSnapshot } from '../domain/types';
import type { ArenaController } from './controller';
import { Dashboard } from './components/Dashboard';
import { DetailView } from './components/DetailView';
import { applyServerMessage, hasActiveAgents } from './state';

type ViewMode = 'dashboard' | 'detail';

const toPtyInput = (input: string, key: { [key: string]: boolean | undefined }): string => {
  if (key.return) {
    return '\r';
  }
  if (key.tab) {
    return '\t';
  }
  if (key.backspace || key.delete) {
    return '\u007f';
  }
  if (key.upArrow) {
    return '\u001b[A';
  }
  if (key.downArrow) {
    return '\u001b[B';
  }
  if (key.leftArrow) {
    return '\u001b[D';
  }
  if (key.rightArrow) {
    return '\u001b[C';
  }

  return input;
};

export interface AppProps {
  controller: ArenaController;
  title: string;
  onExit?: () => Promise<void> | void;
}

export const App = ({ controller, title, onExit }: AppProps): React.JSX.Element => {
  const { exit } = useApp();
  const [snapshot, setSnapshot] = useState<ArenaSnapshot | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [interactive, setInteractive] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [quitConfirm, setQuitConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribed = false;
    void controller.loadSnapshot().then(
      (loaded) => {
        if (!unsubscribed) {
          setSnapshot(loaded);
        }
      },
      (loadError: unknown) => {
        if (!unsubscribed) {
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    );

    const unsubscribe = controller.subscribe((message) => {
      setSnapshot((current) => (current ? applyServerMessage(current, message) : current));
      if (message.type === 'error') {
        setError(message.message);
      }
    });

    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      unsubscribed = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [controller]);

  const agents = snapshot?.agents ?? [];
  const currentAgent = agents[selectedIndex];

  useEffect(() => {
    if (selectedIndex >= agents.length && agents.length > 0) {
      setSelectedIndex(agents.length - 1);
    }
  }, [agents.length, selectedIndex]);

  const footer = useMemo(() => {
    if (interactive) {
      return 'Interactive mode: typing is sent to the agent PTY. Press Esc to leave.';
    }
    if (quitConfirm) {
      return 'Agents are still running. Press q again to terminate them and quit.';
    }
    return 'Tab/1-9 switch agents, d toggles views, q quits.';
  }, [interactive, quitConfirm]);

  const requestExit = (): void => {
    void Promise.resolve(onExit?.()).finally(() => {
      void Promise.resolve(controller.dispose?.()).finally(() => {
        exit();
      });
    });
  };

  useInput((input, key) => {
    if (!snapshot || agents.length === 0) {
      return;
    }

    if (interactive && currentAgent) {
      if (key.escape) {
        setInteractive(false);
        setQuitConfirm(false);
        void controller.setInteractive?.(currentAgent.name, false);
        return;
      }

      void controller.sendInput(currentAgent.name, toPtyInput(input, key));
      return;
    }

    if (key.tab) {
      setSelectedIndex((current) => (current + 1) % agents.length);
      setScrollOffset(0);
      return;
    }

    if (/^[1-9]$/.test(input)) {
      const nextIndex = Number(input) - 1;
      if (nextIndex < agents.length) {
        setSelectedIndex(nextIndex);
        setScrollOffset(0);
      }
      return;
    }

    if (input === 'd') {
      setViewMode((current) => (current === 'dashboard' ? 'detail' : 'dashboard'));
      setScrollOffset(0);
      return;
    }

    if (input === 'q') {
      if (hasActiveAgents(snapshot) && !quitConfirm) {
        setQuitConfirm(true);
        return;
      }
      requestExit();
      return;
    }

    setQuitConfirm(false);

    if (viewMode === 'dashboard') {
      if (key.upArrow) {
        setSelectedIndex((current) => Math.max(0, current - 1));
      } else if (key.downArrow) {
        setSelectedIndex((current) => Math.min(agents.length - 1, current + 1));
      } else if (key.return) {
        setViewMode('detail');
      }
      return;
    }

    if (input === 'i' && currentAgent) {
      setInteractive(true);
      void controller.setInteractive?.(currentAgent.name, true);
      return;
    }

    if (input === 'k' && currentAgent) {
      void controller.killAgent(currentAgent.name);
      return;
    }

    if (input === 'r' && currentAgent) {
      void controller.restartAgent(currentAgent.name);
      return;
    }

    if (key.upArrow) {
      setScrollOffset((current) => Math.min(current + 1, Math.max(0, currentAgent?.outputLines.length ?? 0)));
    } else if (key.downArrow) {
      setScrollOffset((current) => Math.max(0, current - 1));
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      {error ? <Text color="red">{error}</Text> : null}
      {!snapshot ? (
        <Text>Loading arena state...</Text>
      ) : viewMode === 'dashboard' ? (
        <Dashboard agents={snapshot.agents} selectedIndex={selectedIndex} now={now} />
      ) : (
        <DetailView
          agents={snapshot.agents}
          selectedIndex={selectedIndex}
          scrollOffset={scrollOffset}
          interactive={interactive}
          now={now}
        />
      )}
      <Text dimColor>{footer}</Text>
    </Box>
  );
};
