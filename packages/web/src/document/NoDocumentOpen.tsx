import { Text } from "@mantine/core";
import type { ReactNode } from "react";

// Shown by every panel nested under '/_document' in place of its own tool output when no document is open yet -- the panel itself no longer has a FileUpload of its own to prompt with, since opening a document is now the shared action at the top of the layout.
export function NoDocumentOpen({ children }: { children: ReactNode }) {
  return (
    <Text c="dimmed" size="sm">
      {children}
    </Text>
  );
}
