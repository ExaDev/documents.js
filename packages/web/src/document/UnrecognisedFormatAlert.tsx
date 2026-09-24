import { Alert } from "@mantine/core";

// The exact wording Metadata/Fonts/Package each duplicated before this refactor: the three panels that have no manual-format-override fallback (unlike Convert/Inspect, which offer a Select instead) and so simply can't proceed without a recognised extension.
export function UnrecognisedFormatAlert({ fileName }: { fileName: string }) {
  return (
    <Alert color="red">
      Could not recognise "{fileName}"'s format from its extension.
    </Alert>
  );
}
