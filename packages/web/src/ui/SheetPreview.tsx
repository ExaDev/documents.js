import {
  Badge,
  Group,
  LoadingOverlay,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { assignInlineVars } from "@vanilla-extract/dynamic";
import { columnIndexToLetters } from "documents.js";
import type {
  ContentCellFill,
  ContentDocument,
  ContentSheet,
  ContentSheetCell,
} from "documents.js";
import type { ReactNode } from "react";
import { useState } from "react";

import { flexColumn, previewFrame } from "./previewPanel.css";
import * as styles from "./SheetPreview.css";

export interface SheetPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders a spreadsheet-sourced ContentDocument as a real data grid instead of round-tripping it through the PDF pipeline (xlsxToPdf/odsToPdf) the way PdfPreview does -- that applies the *print* layout (page breaks, margins, repeat rows), useful for "what prints" but not for browsing the data itself (see ExaDev/documents#2). Unlike markdown, ContentSheet has no private-convention problem to normalize -- every field consumed here is already part of document-schema.js's own public schema.
export function SheetPreview({
  label,
  format,
  content,
  loading,
  error,
}: SheetPreviewProps) {
  const sheets = content?.kind === "spreadsheet" ? content.sheets : undefined;
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  // Clamped rather than reset via an effect -- if `content` changes to a sheet count smaller than the previously-selected index, this falls back to the last real sheet instead of an effect racing the render.
  const clampedIndex =
    sheets !== undefined && sheets.length > 0
      ? Math.min(activeSheetIndex, sheets.length - 1)
      : 0;
  const activeSheet = sheets?.[clampedIndex];

  return (
    <Stack gap={4} className={flexColumn}>
      <Group gap="xs">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Badge size="xs" variant="light">
          {format}
        </Badge>
      </Group>
      <Paper
        withBorder
        pos="relative"
        className={previewFrame({ scroll: true })}
      >
        <LoadingOverlay visible={loading === true} />
        {error !== undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              Preview unavailable for this format.
            </Text>
          </Group>
        ) : sheets === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          <Stack gap={0}>
            {sheets.length > 1 && (
              <SegmentedControl
                size="xs"
                value={String(clampedIndex)}
                onChange={(value) => {
                  setActiveSheetIndex(Number(value));
                }}
                data={sheets.map((sheet, index) => ({
                  value: String(index),
                  label: sheet.name,
                }))}
                className={styles.segmentedControl}
              />
            )}
            {activeSheet !== undefined && renderSheetTable(activeSheet)}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function renderSheetTable(sheet: ContentSheet): ReactNode {
  const cellMap = new Map<string, ContentSheetCell>();
  for (const cell of sheet.cells) {
    cellMap.set(`${cell.row}:${cell.column}`, cell);
  }
  const rows = [...sheet.rows]
    .filter((row) => row.hidden !== true)
    .sort((a, b) => a.index - b.index);
  const columns = [...sheet.columns]
    .filter((column) => column.hidden !== true)
    .sort((a, b) => a.index - b.index);

  if (rows.length === 0 || columns.length === 0) {
    return (
      <Text c="dimmed" size="sm" p="md">
        Empty sheet.
      </Text>
    );
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th className={styles.cornerCell} />
          {columns.map((column) => (
            <th key={column.index} className={styles.headerCell}>
              {columnIndexToLetters(column.index)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.index}>
            <th className={styles.rowHeaderCell}>{row.index + 1}</th>
            {columns.map((column) => {
              const cell = cellMap.get(`${row.index}:${column.index}`);
              return (
                <td
                  key={column.index}
                  colSpan={cell?.colSpan}
                  rowSpan={cell?.rowSpan}
                  className={cellClassName(cell)}
                  style={cellBackgroundStyle(cell)}
                >
                  {cell?.displayText ?? ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function cellClassName(cell: ContentSheetCell | undefined): string {
  const kind = cell?.value.kind;
  const defaultAlign =
    kind === "number" || kind === "percentage" || kind === "currency"
      ? "right"
      : kind === "boolean"
        ? "center"
        : "left";
  return styles.cell({
    align: cell?.alignment ?? defaultAlign,
    verticalAlign: cell?.verticalAlignment ?? "bottom",
    error: kind === "error",
  });
}

// A cell's own background is a discriminated 'solid'/'pattern' ContentCellFill (documents.js re-exporting document-schema.js's own shape). This preview renders one flat swatch either way, so a 'pattern' fill picks its own most-representative single colour -- the foreground, falling back to the background, mirroring document-schema.js's own resolveCellFillColor rather than importing it. document-schema.js is an allowed direct dependency here (it isn't one of the packages this UI layer is restricted from importing -- see this package's own README), but importing resolveCellFillColor from it measurably grows the bundle regardless of which module the import names: rebuilding with the import in place (via the package root, and again via its own `document-schema.js/content` subpath) grew the convert-route chunk from 22.69 kB to 39.11 kB (gzip 6.78 kB to 11.34 kB) and the shared vendor-data chunk from 137.21 kB to 175.40 kB (gzip 43.54 kB to 52.88 kB) either way -- document-schema.js's Zod schema graph doesn't tree-shake, so even one function pulls the rest of the graph in behind it. Three lines of duplicated logic is cheaper than that.
function previewColor(
  fill: ContentCellFill | undefined,
): { r: number; g: number; b: number } | undefined {
  if (fill === undefined) {
    return undefined;
  }
  return fill.kind === "solid"
    ? fill.color
    : (fill.foregroundColor ?? fill.backgroundColor);
}

function cellBackgroundStyle(cell: ContentSheetCell | undefined) {
  const color = previewColor(cell?.background);
  return assignInlineVars({
    [styles.cellBackgroundVar]:
      color !== undefined
        ? `rgb(${color.r * 255} ${color.g * 255} ${color.b * 255})`
        : undefined,
  });
}
