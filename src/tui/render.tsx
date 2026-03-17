import React from 'react';
import { render } from 'ink';
import type { ArenaController } from './controller';
import { App } from './App';

export const renderArenaApp = async (
  controller: ArenaController,
  title: string,
  onExit?: () => Promise<void> | void
): Promise<void> => {
  const instance = render(<App controller={controller} title={title} onExit={onExit} />);
  await instance.waitUntilExit();
};
