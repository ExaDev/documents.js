import { Badge, Group, List, Spoiler, Stack, Text } from "@mantine/core";

import type { Diagnostic } from "../shared/diagnostics";

export interface DiagnosticsPanelProps {
  diagnostics: readonly Diagnostic[];
}

// Info-severity diagnostics collapse behind a Spoiler once there are more than a handful -- a user scanning for what needs attention shouldn't have to read past advisory noise to find it. Warnings always render expanded: they're the ones with real consequences for whether the output can be trusted.
const INFO_COLLAPSE_THRESHOLD = 5;

function DiagnosticRow({ diagnostic }: { diagnostic: Diagnostic }) {
  return (
    <List.Item>
      <Group gap="xs" wrap="nowrap">
        {diagnostic.pageIndex !== undefined && (
          <Badge size="sm" variant="light">
            Page {diagnostic.pageIndex + 1}
          </Badge>
        )}
        <Text size="sm">{diagnostic.message}</Text>
      </Group>
    </List.Item>
  );
}

export function DiagnosticsPanel({ diagnostics }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) return null;

  const warnings = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );
  const info = diagnostics.filter(
    (diagnostic) => diagnostic.severity === "info",
  );

  const infoList = (
    <List size="sm" spacing="xs">
      {info.map((diagnostic, index) => (
        <DiagnosticRow key={index} diagnostic={diagnostic} />
      ))}
    </List>
  );

  return (
    <Stack gap="xs">
      {warnings.length > 0 && (
        <List size="sm" spacing="xs" c="orange">
          {warnings.map((diagnostic, index) => (
            <DiagnosticRow key={index} diagnostic={diagnostic} />
          ))}
        </List>
      )}
      {info.length > 0 &&
        (info.length > INFO_COLLAPSE_THRESHOLD ? (
          <Spoiler
            maxHeight={0}
            showLabel={`Show ${info.length} more`}
            hideLabel="Show less"
          >
            {infoList}
          </Spoiler>
        ) : (
          infoList
        ))}
    </Stack>
  );
}
