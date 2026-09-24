import { Stack, Text, Title } from "@mantine/core";
import type { ReactNode } from "react";

import { header, width } from "./ToolPage.css";

/** Which measure a page's content is laid out in. `panel` is the default and covers forms, label/value pairs and narrow tables; `canvas` is for a page whose content is a rendered document or a table wide enough that a measure would only force it to scroll sideways. */
export type ToolPageWidth = keyof typeof width;

export interface ToolPageProps {
  /** The page's own name, rendered as its only h2. Sentence case, and a noun phrase rather than an instruction, since the sidebar link next to it is already the verb. */
  title: string;
  /** One sentence on what the tool does or which formats it covers, when that is not obvious from the title alone. Omitted rather than padded out when it is. */
  description?: string;
  width?: ToolPageWidth;
  children: ReactNode;
}

/**
 * The shell every tool page renders inside, holding the three decisions those pages used to each make for themselves: how wide the content column is, how the page's own heading is set, and how far apart its sections sit.
 *
 * Before this, eight structurally identical pages picked between `Container size="sm"`, `size="lg"` and `fluid` with no rule behind the choice, and each added its own `py="xl"` on top of the padding the layout route had already applied, so no two pages started at the same place on screen or at the same distance from the bar above them. The layout owns the region's padding; this owns everything inside it.
 */
export function ToolPage({
  title,
  description,
  width: pageWidth = "panel",
  children,
}: ToolPageProps) {
  return (
    <Stack className={width[pageWidth]} gap="lg">
      <Stack className={header} gap="xs">
        <Title order={2}>{title}</Title>
        {description !== undefined && (
          <Text c="dimmed" size="sm">
            {description}
          </Text>
        )}
      </Stack>
      {children}
    </Stack>
  );
}
