import { notifications } from '@mantine/notifications';

import type { Diagnostic } from '../shared/diagnostics';

// Diagnostics are a normal, expected part of a successful conversion, not just an error signal -- a font substitution or a dropped feature is something the user may need to act on before trusting the output. A toast alone risks auto-dismissing that; the DiagnosticsPanel (rendered inline by the caller) is where the detail lives permanently. This toast is only the ambient "something happened" acknowledgement, so it auto-dismisses unless there's a warning-severity diagnostic to flag.
export function notifySuccess(message: string, options?: { diagnostics?: readonly Diagnostic[] }) {
  const warningCount = options?.diagnostics?.filter((diagnostic) => diagnostic.severity === 'warning').length ?? 0;
  notifications.show({
    color: warningCount > 0 ? 'yellow' : 'teal',
    title: warningCount > 0 ? `${message} -- ${warningCount} to review` : message,
    message: warningCount > 0 ? 'See the details below for what changed.' : '',
    autoClose: warningCount > 0 ? false : 4000,
  });
}

export function notifyError(title: string, error: unknown) {
  notifications.show({
    color: 'red',
    title,
    message: error instanceof Error ? error.message : String(error),
    autoClose: false,
  });
}
