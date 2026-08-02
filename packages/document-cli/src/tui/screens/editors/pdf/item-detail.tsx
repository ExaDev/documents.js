import type { ContentStroke, LayoutColor, LayoutItem } from 'documents.js';
import { Box, Text, useInput } from 'ink';
import type { ReactElement } from 'react';
import { useAppDispatch, useAppState } from '../../../state/context.js';
import { anyOverlayOpen, currentScreen } from '../../../state/types.js';
import { formatSize, requirePdfDocument } from './shared.js';

type Field = readonly [label: string, value: string];

function formatPoint(xPt: number, yPt: number): string {
  return `(${xPt.toFixed(1)}, ${yPt.toFixed(1)})pt`;
}

// documents.js re-exports `rgbHexToColor` (hex string -> Color) at its top level but not that conversion's own inverse, `colorToRgbHex` -- this is display-only formatting for this one read-only screen, not a reimplementation of that (unexported) function.
function formatColor(color: LayoutColor): string {
  const byte = (component: number): string => Math.round(component * 255).toString(16).padStart(2, '0');
  return `#${byte(color.r)}${byte(color.g)}${byte(color.b)}`;
}

function formatStroke(stroke: ContentStroke): string {
  return `${formatColor(stroke.color)} @ ${stroke.widthPt.toFixed(1)}pt`;
}

// A full field dump of one `LayoutItem`, kind by kind -- every field the item's own schema variant carries, formatted for reading rather than parsed or interpreted further. `sourcePath` is common to every variant, so it is appended once after the kind-specific fields rather than repeated in each branch.
function fieldsFor(item: LayoutItem): readonly Field[] {
  const fields: Field[] = [['Kind', item.kind]];
  switch (item.kind) {
    case 'text':
      fields.push(['Text', item.text]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Font family', item.font.family]);
      fields.push(['Font weight', item.font.weight]);
      fields.push(['Font style', item.font.style]);
      fields.push(['Size', `${item.sizePt}pt`]);
      fields.push(['Colour', formatColor(item.color)]);
      if (item.widthPt !== undefined) {
        fields.push(['Width', `${item.widthPt}pt`]);
      }
      if (item.rotationDeg !== undefined) {
        fields.push(['Rotation', `${item.rotationDeg}°`]);
      }
      if (item.underline !== undefined) {
        fields.push(['Underline', item.underline ? 'yes' : 'no']);
      }
      break;
    case 'image':
      fields.push(['Image ID', item.imageId]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      if (item.rotationDeg !== undefined) {
        fields.push(['Rotation', `${item.rotationDeg}°`]);
      }
      break;
    case 'rect':
    case 'ellipse':
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      if (item.fill !== undefined) {
        fields.push(['Fill', formatColor(item.fill)]);
      }
      if (item.stroke !== undefined) {
        fields.push(['Stroke', formatStroke(item.stroke)]);
      }
      break;
    case 'line':
      fields.push(['From', formatPoint(item.x1Pt, item.y1Pt)]);
      fields.push(['To', formatPoint(item.x2Pt, item.y2Pt)]);
      fields.push(['Colour', formatColor(item.color)]);
      fields.push(['Width', `${item.widthPt}pt`]);
      break;
    case 'path':
      fields.push(['Subpaths', `${item.subpaths.length}`]);
      fields.push(['Segments', `${item.subpaths.reduce((total, subpath) => total + subpath.segments.length, 0)}`]);
      if (item.fill !== undefined) {
        fields.push(['Fill', formatColor(item.fill)]);
      }
      if (item.fillRule !== undefined) {
        fields.push(['Fill rule', item.fillRule]);
      }
      if (item.stroke !== undefined) {
        fields.push(['Stroke', formatStroke(item.stroke)]);
      }
      break;
    case 'link':
      fields.push(['URI', item.uri]);
      fields.push(['Position', formatPoint(item.xPt, item.yPt)]);
      fields.push(['Size', formatSize(item.widthPt, item.heightPt)]);
      break;
    default: {
      // Exhaustiveness check, not a runtime fallback: if `LayoutItem` ever grows a kind this switch does not handle, `item` stops narrowing to `never` here and the assignment below fails to compile.
      const exhaustive: never = item;
      return exhaustive;
    }
  }
  if (item.sourcePath !== undefined) {
    fields.push(['Source path', item.sourcePath]);
  }
  return fields;
}

// The simplest screen in this group: no list, no selection, just every field of the one selected `LayoutItem` rendered as a label/value dump.
export function PdfItemDetailScreen(): ReactElement {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const doc = requirePdfDocument(state.openDocument);
  const screen = currentScreen(state);
  if (screen.kind !== 'pdfItemDetail') {
    throw new Error(`PdfItemDetailScreen rendered while the current screen is "${screen.kind}", not "pdfItemDetail".`);
  }
  const page = doc.layout.pages[screen.pageIndex];
  if (page === undefined) {
    throw new Error(`pdfItemDetail was pushed for page ${screen.pageIndex}, but the open PDF has no page at that index.`);
  }
  const item = page.items[screen.itemIndex];
  if (item === undefined) {
    throw new Error(`pdfItemDetail was pushed for item ${screen.itemIndex} on page ${screen.pageIndex}, but that page has no item at that index.`);
  }

  useInput(
    (input, key) => {
      if (key.escape || key.leftArrow || input === 'h') {
        dispatch({ type: 'POP_SCREEN' });
      }
    },
    { isActive: !anyOverlayOpen(state) },
  );

  return (
    <Box flexDirection="column">
      <Text bold>
        Page {screen.pageIndex + 1}, item {screen.itemIndex + 1}
      </Text>
      {fieldsFor(item).map(([label, value]) => (
        <Text key={label}>
          {label}: {value}
        </Text>
      ))}
      <Text dimColor>Esc / ← / h to go back</Text>
    </Box>
  );
}
