import { Box, Text } from 'ink';
import { useEffect, type ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../state/context.js';
import type { StatusMessage } from '../state/types.js';

// An info or warning message clears itself after this long; an error stays until something replaces it, because an error the user missed is worse than a bar that has stopped being current. Expiry runs on a timer rather than by comparing `Date.now()` during render: reading the clock while rendering is impure, and a comparison alone would leave a message on screen past its own TTL until some unrelated state change forced a repaint.
const TRANSIENT_STATUS_TTL_MS = 4000;

function statusColour(severity: StatusMessage['severity']): string {
  switch (severity) {
    case 'info':
      return 'cyan';
    case 'warning':
      return 'yellow';
    case 'error':
      return 'red';
  }
}

export function StatusLine(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const status = state.status;
  const isTransient = status !== undefined && status.severity !== 'error';
  // `createdAtMs` is the dependency that makes a replacement message restart the timer, even when the new message happens to read identically to the one it replaced.
  const createdAtMs = status?.createdAtMs;

  useEffect(() => {
    if (!isTransient || createdAtMs === undefined) {
      return;
    }
    const timer = setTimeout(() => {
      dispatch({ type: 'CLEAR_STATUS' });
    }, TRANSIENT_STATUS_TTL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isTransient, createdAtMs, dispatch]);

  const path = state.openDocument === undefined ? 'no document' : (state.openDocument.path ?? 'untitled');
  const showDiagnosticsBadge = state.diagnostics.length > 0 && !state.overlays.diagnosticsPanel;

  return (
    <Box>
      <Text dimColor>{path}</Text>
      {state.hasUnsavedChanges ? <Text color="yellow"> ●</Text> : undefined}
      {status === undefined ? undefined : <Text color={statusColour(status.severity)}> {status.text}</Text>}
      {showDiagnosticsBadge ? <Text color="yellow"> ⚠ {state.diagnostics.length} diagnostics -- Ctrl+D</Text> : undefined}
    </Box>
  );
}
