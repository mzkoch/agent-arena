# VT Terminal Emulator (#2) + Clean Monitor Disconnect (#7)

## Overview

Replace the current `OutputBuffer` (line-based text accumulator) with a proper VT terminal emulator using `@xterm/headless`, and implement clean monitor disconnect so remote monitors can disconnect without affecting running agents.

## Architecture Decisions

These decisions are mandatory — follow them exactly.

### 1. VirtualTerminal Write Model: Promise-queue with callback
- Use xterm's public `write(data, callback)` API — do NOT use private `_writeBuffer.writeSync()`
- Serialize writes via a promise queue chain to prevent concurrent write issues:
  ```typescript
  public write(data: string): Promise<void> {
    this.writeQueue = this.writeQueue.then(() =>
      new Promise<void>(resolve => {
        this.terminal.write(data, () => {
          this.snapshotDirty = true;
          this.version += 1;
          // mark all viewport rows dirty
          for (let i = 0; i < this.terminal.rows; i++) {
            this.dirtyRows.add(i);
          }
          resolve();
        });
      })
    );
    return this.writeQueue;
  }
  ```
- Chain `getDelta()` after the callback fires to guarantee delta accuracy
- In `handleData()`, store the write promise and chain delta emission:
  ```typescript
  agent.pendingWrite = vterm.write(chunk).then(() => {
    this.emit('message', { type: 'agent-terminal', agent: agentName, delta: vterm.getDelta() });
  });
  ```

### 2. Dirty Tracking: Mark all viewport rows
- On every `write()` callback, mark ALL viewport rows dirty (simple loop over `terminal.rows`)
- `getDelta()` compares only dirty rows against last-emitted content — 40 string comparisons, negligible
- Do NOT implement predictive dirty tracking (buffer-shift detection, escape-code sniffing, cursor-range)

### 3. Serialization: @xterm/addon-serialize per-row
- Install `@xterm/addon-serialize` as a dependency
- Use `serializer.serialize({ range: { start: row, end: row } })` to produce ANSI-preserving strings per row
- This preserves colors, bold, underline in the output — `translateToString()` strips all formatting
- Use `translateToString(true)` only for `getPlainText()` (marker detection, diagnostics)
- Do NOT serialize the full buffer and split by newline — serialize per dirty row only

### 4. Marker Detection: Plain-text accumulator
- Maintain a `plainTextChunks: string[]` array, pushing `stripAnsi(data)` synchronously on every `write()` call (before the async xterm callback)
- Marker detection in `handleData()` reads from `stripAnsi(chunk)` directly — synchronous, independent of xterm processing
- Provide `getPlainText(): string` that joins the accumulator for error recovery and diagnostics

### 5. Client Identification: ConnectMessage handshake
- Add `ConnectMessage` to the IPC protocol:
  ```typescript
  interface ConnectMessage { type: 'connect'; clientType: 'controller' | 'monitor' }
  ```
- Client sends `ConnectMessage` immediately after TCP connect
- Server tracks a `readySockets: Set<net.Socket>` — only sends the initial snapshot AFTER receiving the `ConnectMessage`
- This separates "TCP connected" from "ready to receive" — prevents race conditions
- Do NOT default sockets to controller or identify by socket order

### 6. Delta Version Checking: Strict sequential validation
- Client rejects deltas where `delta.version !== localTerminal.version + 1`
- On version gap, client sends a `RequestSnapshotMessage` to the server to get a full `TerminalSnapshot` for recovery
- Add `RequestSnapshotMessage` to the protocol:
  ```typescript
  interface RequestSnapshotMessage { type: 'request-snapshot'; agent: string }
  ```

### 7. Reconnecting Client: Explicit listener detach/reattach
- `ReconnectingIpcClient` wraps `ArenaIpcClient` with exponential backoff (base 1s, multiplier 1.5, max 10 retries)
- On reconnect: explicitly detach event listeners from old client (`off('message', ...)`, `off('close', ...)`) before creating new connection
- Attach fresh listeners to new client instance
- This prevents memory leaks from stale listeners accumulating across reconnect cycles
- Emit connection state events: `'connected'`, `'disconnected'`, `'reconnecting'`

### 8. No Backward Compatibility
- Drop `agent-output` message type entirely — clean break
- Do NOT emit both old and new formats

## Key Types

```typescript
// src/terminal/types.ts
interface TerminalCursor {
  row: number;
  col: number;
  visible: boolean;
}

interface TerminalSnapshot {
  cols: number;
  rows: number;
  scrollback: number;
  lines: string[];          // ANSI string rows via SerializeAddon
  cursor: TerminalCursor;
  version: number;
}

interface TerminalDelta {
  version: number;
  changedLines: Array<{ row: number; content: string }>;  // ANSI strings
  cursor?: TerminalCursor;
}
```

```typescript
// IPC protocol additions (src/ipc/protocol.ts)
interface AgentTerminalMessage { type: 'agent-terminal'; agent: string; delta: TerminalDelta }
interface DisconnectMessage { type: 'disconnect' }
interface ConnectMessage { type: 'connect'; clientType: 'controller' | 'monitor' }
interface RequestSnapshotMessage { type: 'request-snapshot'; agent: string }

// Add to ClientToServerMessage union: ConnectMessage, DisconnectMessage, RequestSnapshotMessage
// Add to ServerToClientMessage union: AgentTerminalMessage
```

```typescript
// src/tui/controller.ts
interface ArenaControllerCapabilities {
  mode: 'local' | 'monitor';
  canSendInput: boolean;
  canKill: boolean;
  canRestart: boolean;
  canResizePty: boolean;
}
```

```typescript
// Modified AgentSnapshot (src/domain/types.ts)
// REMOVE: outputLines, lineCount
// ADD: terminal: TerminalSnapshot
```

## Components to Implement

### 1. VirtualTerminal (`src/orchestrator/virtual-terminal.ts`)
- Wraps `@xterm/headless` Terminal + `@xterm/addon-serialize` SerializeAddon
- Constructor: `(cols = 120, rows = 40, scrollback = 1000)`
- `write(data: string): Promise<void>` — promise-queue model as described above
- `getSnapshot(): TerminalSnapshot` — cached; only rebuilds when dirty
- `getDelta(): TerminalDelta` — compares dirty rows against last-emitted, clears dirty set
- `getPlainText(): string` — joins plainTextChunks accumulator
- `resize(cols: number, rows: number): void` — resizes terminal, marks all dirty
- `dispose(): void` — cleans up terminal instance

### 2. ArenaOrchestrator Changes (`src/orchestrator/arena-orchestrator.ts`)
- Replace `OutputBuffer` with `VirtualTerminal` per agent
- `handleData()`: write to vterm, chain delta emission after write completes, detect markers on `stripAnsi(chunk)` synchronously
- `getSnapshot()`: include `terminal: TerminalSnapshot` in each agent's snapshot (NOT outputLines)
- `resizeAll(cols, rows)`: resize all agent vterminals + PTYs
- Handle `request-snapshot` from clients — respond with agent's current TerminalSnapshot

### 3. Controller Capabilities (`src/tui/controller.ts`)
- Add `ArenaControllerCapabilities` interface
- `LocalArenaController`: `{ mode: 'local', canSendInput: true, canKill: true, canRestart: true, canResizePty: true }`
- `RemoteArenaController` (monitor): `{ mode: 'monitor', canSendInput: false, canKill: false, canRestart: false, canResizePty: false }`
- Both controllers expose `capabilities` getter

### 4. Monitor Disconnect (`src/tui/App.tsx`, `src/cli.ts`)
- Monitor footer: `"Tab/1-9 switch agents, d toggles views, q exits monitor (arena keeps running)."`
- Monitor `q` press: no confirmation dialog, just disconnect and exit
- Guard all mutation keybindings (`i` for input, `k` for kill, `r` for restart) behind capabilities
- Send `DisconnectMessage` before closing socket

### 5. TerminalView Component (`src/tui/components/TerminalView.tsx`)
- Renders terminal snapshot lines as ANSI strings (Ink `<Text>` renders ANSI natively)
- Supports scroll offset and max visible lines
- Used by DetailView to replace the current output rendering

### 6. Client-Side State (`src/tui/state.ts`)
- Handle `agent-terminal` messages: apply delta to agent's terminal snapshot
- Strict version check: reject if `delta.version !== agent.terminal.version + 1`
- On version gap: emit `request-snapshot` to server
- Handle incoming full snapshots for recovery

### 7. IPC Protocol Updates (`src/ipc/protocol.ts`)
- Add all new message types to the unions
- Add `MUTATING_MESSAGE_TYPES` constant: `new Set(['input', 'kill', 'restart'])`

### 8. Server-Side Enforcement (`src/ipc/server.ts`)
- Track client type via `clientTypes: Map<net.Socket, 'controller' | 'monitor'>`
- Track ready state via `readySockets: Set<net.Socket>`
- On `ConnectMessage`: set client type, add to readySockets, send snapshot
- Reject mutating messages from monitor clients with error message
- Handle `disconnect` message: clean up socket, remove from tracking maps
- Handle `request-snapshot`: respond with current agent terminal snapshot

### 9. ReconnectingIpcClient (`src/ipc/reconnecting-client.ts`)
- Wraps ArenaIpcClient with auto-reconnect
- Exponential backoff: base 1000ms, multiplier 1.5, max 10 retries
- Explicit listener detach/reattach lifecycle on reconnect
- Emits `'connected'`, `'disconnected'`, `'reconnecting'` events
- `close()` sets intentionallyClosed flag to prevent reconnect on user-initiated disconnect

### 10. Resize Handling (`src/cli.ts`, `src/orchestrator/arena-orchestrator.ts`)
- Local launch: listen for `process.stdout.on('resize')`, call `orchestrator.resizeAll(cols, rows)`
- `resizeAll()`: resize each agent's VirtualTerminal and PTY
- Monitor: does NOT resize PTY — `canResizePty: false` in capabilities

## Files to Add
- `src/terminal/types.ts` — TerminalSnapshot, TerminalDelta, TerminalCursor
- `src/terminal/index.ts` — barrel export
- `src/orchestrator/virtual-terminal.ts` — VirtualTerminal class
- `src/orchestrator/virtual-terminal.test.ts` — VirtualTerminal unit tests
- `src/ipc/reconnecting-client.ts` — ReconnectingIpcClient
- `src/ipc/reconnecting-client.test.ts` — ReconnectingIpcClient tests
- `src/tui/components/TerminalView.tsx` — Terminal rendering component

## Files to Modify
- `src/ipc/protocol.ts` — new message types, updated unions
- `src/ipc/server.ts` — client type tracking, readySockets, enforcement, connect/disconnect handling
- `src/ipc/server.test.ts` — tests for enforcement, connect handshake
- `src/orchestrator/arena-orchestrator.ts` — OutputBuffer → VirtualTerminal, delta emission, resizeAll
- `src/orchestrator/arena-orchestrator.test.ts` — updated tests
- `src/tui/controller.ts` — ArenaControllerCapabilities, capabilities getter
- `src/tui/controller.test.ts` — capability tests
- `src/tui/App.tsx` — capabilities-driven keybindings, monitor disconnect UX
- `src/tui/state.ts` — agent-terminal handling, version checking, delta application
- `src/tui/state.test.ts` — delta application tests, version gap tests
- `src/tui/components/DetailView.tsx` — use TerminalView instead of raw output
- `src/domain/types.ts` — AgentSnapshot: remove outputLines/lineCount, add terminal
- `src/cli.ts` — monitor connect handshake, resize handler, disconnect message
- `package.json` — add @xterm/addon-serialize dependency

## Validation Criteria

All of the following must pass:
```bash
npm run build          # TypeScript compilation succeeds
npm run lint           # Zero warnings
npx tsc --noEmit       # Type checking passes
npm run test           # All tests pass
```

### Required Test Coverage
- VirtualTerminal: write → getDelta accuracy, snapshot caching, dirty tracking, resize, plainTextChunks accumulator, concurrent writes via promise queue, ANSI preservation via SerializeAddon
- Delta protocol: apply delta to snapshot, strict version rejection, version gap → request-snapshot recovery
- ConnectMessage handshake: server waits for connect before sending snapshot, client type correctly set
- Server enforcement: monitor client mutating messages rejected, controller messages accepted
- ReconnectingIpcClient: connect, close, reconnect with backoff, max retries exhausted, listener cleanup (no stale listeners after reconnect), intentional close prevents reconnect
- Monitor disconnect: clean exit without confirmation, disconnect message sent, arena keeps running
- Capabilities: controller vs monitor capabilities, UI guards respect capabilities
- Resize: local resize propagates to PTY + VT, monitor resize does NOT propagate
