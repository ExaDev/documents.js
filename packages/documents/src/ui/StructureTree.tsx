import { Tree } from "@mantine/core";

import { toTreeData } from "../shared/jsonTree";
import { container } from "./StructureTree.css";

export interface StructureTreeProps {
  data: unknown;
}

// Browses the real document structure (a sanitized LayoutDocument, in this app's case) as a collapsible tree rather than a wall of stats -- Mantine's own Tree starts every node collapsed by default, so this stays compact on first render regardless of how large the underlying document is.
export function StructureTree({ data }: StructureTreeProps) {
  const treeData = toTreeData(data);
  if (treeData.length === 0) return null;

  return (
    <div className={container}>
      <Tree data={treeData} withLines />
    </div>
  );
}
