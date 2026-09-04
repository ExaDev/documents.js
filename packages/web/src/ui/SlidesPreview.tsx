import {
  Badge,
  Group,
  LoadingOverlay,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import type {
  ContentDocument,
  ContentDrawPage,
  ContentShape,
  ContentSlide,
  ContentStroke,
  ContentSubpath,
  ContentVector,
} from "documents.js";
import type { ReactNode } from "react";
import { useState } from "react";

import { renderBlocksNeutral } from "./contentBlocks";
import { flexColumn, previewFrame } from "./previewPanel.css";
import * as styles from "./SlidesPreview.css";

export interface SlidesPreviewProps {
  label: string;
  format: string;
  content?: ContentDocument;
  loading?: boolean;
  error?: unknown;
}

// Renders a presentation (pptx/odp) or drawing (odg) ContentDocument natively as SVG instead of routing through a PDF rendition. Each slide/page is an SVG whose viewBox matches the original point dimensions, so the browser handles all scaling. Shapes (positioned text boxes) render as <foreignObject> containing HTML -- the browser handles text wrapping natively, an accepted fidelity trade-off vs documents.js's pixel-exact TextMeasurer. Vectors (rect, ellipse, line, path) render as native SVG elements. fontScale/lineSpacingReduction (OOXML autofit) are pre-computed scale factors in the ContentDocument, so applying them as CSS font-size/line-height multipliers is correct, not approximate. Known gaps: embedded objects and page breaks inside shapes render nothing (same gap as WordProcessingPreview).
export function SlidesPreview({
  label,
  format,
  content,
  loading,
  error,
}: SlidesPreviewProps) {
  const slides =
    content?.kind === "presentation"
      ? content.slides
      : content?.kind === "drawing"
        ? content.pages
        : undefined;
  const [activeIndex, setActiveIndex] = useState(0);
  const clampedIndex =
    slides !== undefined && slides.length > 0
      ? Math.min(activeIndex, slides.length - 1)
      : 0;
  const active = slides?.[clampedIndex];

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
        ) : slides === undefined ? (
          <Group h="100%" justify="center">
            <Text c="dimmed" size="sm">
              No preview yet.
            </Text>
          </Group>
        ) : (
          <Stack gap={0}>
            {slides.length > 1 && (
              <SegmentedControl
                size="xs"
                value={String(clampedIndex)}
                onChange={(value) => {
                  setActiveIndex(Number(value));
                }}
                data={slides.map((_slide, index) => ({
                  value: String(index),
                  label: `${index + 1}`,
                }))}
                className={styles.segmentedControl}
              />
            )}
            {active !== undefined && renderSlideOrPage(active)}
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

type SlideOrPage = ContentSlide | ContentDrawPage;

function renderSlideOrPage(slide: SlideOrPage): ReactNode {
  const { widthPt, heightPt } = slide.size;
  const vectors: ContentVector[] = "vectors" in slide ? slide.vectors : [];
  // Merge shapes and vectors by paintOrder (lower = painted first = behind). Slides have no vectors, so this is just shapes in array order; draw-pages interleave the two by paintOrder.
  const items: (
    | { kind: "shape"; data: ContentShape; order: number }
    | { kind: "vector"; data: ContentVector; order: number }
  )[] = [
    ...slide.shapes.map((s) => ({
      kind: "shape" as const,
      data: s,
      order: s.paintOrder ?? Number.POSITIVE_INFINITY,
    })),
    ...vectors.map((v) => ({
      kind: "vector" as const,
      data: v,
      order: v.paintOrder ?? Number.POSITIVE_INFINITY,
    })),
  ].sort((a, b) => a.order - b.order);

  return (
    <div
      className={styles.slideContainer}
      style={{ aspectRatio: `${widthPt} / ${heightPt}` }}
    >
      <svg
        viewBox={`0 0 ${widthPt} ${heightPt}`}
        className={styles.slideSvg}
        preserveAspectRatio="xMidYMid meet"
      >
        {items.map((item, index) =>
          item.kind === "shape"
            ? renderShape(item.data, index)
            : renderVector(item.data, index),
        )}
      </svg>
    </div>
  );
}

function rotationTransform(
  frame: { xPt: number; yPt: number; widthPt: number; heightPt: number },
  rotationDeg: number | undefined,
): string | undefined {
  if (rotationDeg === undefined) return undefined;
  const cx = frame.xPt + frame.widthPt / 2;
  const cy = frame.yPt + frame.heightPt / 2;
  return `rotate(${rotationDeg} ${cx} ${cy})`;
}

function renderShape(shape: ContentShape, key: number): ReactNode {
  const { xPt, yPt, widthPt, heightPt } = shape.frame;
  const fontSize =
    shape.fontScale !== undefined ? `${shape.fontScale}em` : undefined;
  const lineHeight =
    shape.lineSpacingReduction !== undefined
      ? String(1.5 - shape.lineSpacingReduction)
      : undefined;
  const padding = `${shape.insetTopPt}pt ${shape.insetRightPt}pt ${shape.insetBottomPt}pt ${shape.insetLeftPt}pt`;

  return (
    <foreignObject
      key={key}
      x={xPt}
      y={yPt}
      width={widthPt}
      height={heightPt}
      transform={rotationTransform(shape.frame, shape.rotationDeg)}
    >
      <div
        style={{
          padding,
          fontSize,
          lineHeight,
          overflow: "hidden",
          boxSizing: "border-box",
          width: "100%",
          height: "100%",
        }}
      >
        {renderBlocksNeutral(shape.blocks)}
      </div>
    </foreignObject>
  );
}

function renderVector(vector: ContentVector, key: number): ReactNode {
  if (vector.stroke?.style === "double") {
    return renderDoubleStrokeVector(vector, vector.stroke, key);
  }
  return renderVectorSingle(vector, key, undefined);
}

// SVG has no native double stroke. Simulates it by stacking two elements: a thick stroke in the stroke color (3x width) underneath, and a thin stroke in the fill/gap color on top -- the thin overlay creates a gap in the center of the thick underlay, leaving two visible stroke-colored lines. For unfilled shapes, white is used as the gap color (matching the typical slide background).
function renderDoubleStrokeVector(
  vector: ContentVector,
  stroke: ContentStroke,
  key: number,
): ReactNode {
  const fill = "fill" in vector ? colorToCss(vector.fill) : "none";
  const gapColor = fill === "none" ? "white" : fill;
  return (
    <g key={key}>
      {renderVectorSingle(vector, `${key}-underlay`, {
        stroke: colorToCss(stroke.color),
        strokeWidth: stroke.widthPt * 3,
      })}
      {renderVectorSingle(vector, `${key}-gap`, {
        stroke: gapColor,
        strokeWidth: stroke.widthPt,
      })}
    </g>
  );
}

interface StrokeOverride {
  stroke: string;
  strokeWidth: number;
}

function renderVectorSingle(
  vector: ContentVector,
  key: string | number,
  strokeOverride: StrokeOverride | undefined,
): ReactNode {
  const stroke = strokeOverride ?? strokeAttrs(vector.stroke);
  if (vector.kind === "rect" || vector.kind === "ellipse") {
    const { xPt, yPt, widthPt, heightPt } = vector.frame;
    const cx = xPt + widthPt / 2;
    const cy = yPt + heightPt / 2;
    const fill = colorToCss(vector.fill);
    const transform = rotationTransform(vector.frame, vector.rotationDeg);
    if (vector.kind === "rect") {
      return (
        <rect
          key={key}
          x={xPt}
          y={yPt}
          width={widthPt}
          height={heightPt}
          fill={fill}
          transform={transform}
          {...stroke}
        />
      );
    }
    return (
      <ellipse
        key={key}
        cx={cx}
        cy={cy}
        rx={widthPt / 2}
        ry={heightPt / 2}
        fill={fill}
        transform={transform}
        {...stroke}
      />
    );
  }
  if (vector.kind === "line") {
    return (
      <line
        key={key}
        x1={vector.from.xPt}
        y1={vector.from.yPt}
        x2={vector.to.xPt}
        y2={vector.to.yPt}
        {...stroke}
      />
    );
  }
  return (
    <path
      key={key}
      d={buildPathData(vector.subpaths)}
      fill={colorToCss(vector.fill)}
      fillRule={vector.fillRule}
      transform={rotationTransform(vector.frame, vector.rotationDeg)}
      {...stroke}
    />
  );
}

function colorToCss(
  color: { r: number; g: number; b: number } | undefined,
): string {
  return color === undefined
    ? "none"
    : `rgb(${Math.round(color.r * 255)} ${Math.round(color.g * 255)} ${Math.round(color.b * 255)})`;
}

function strokeAttrs(stroke: ContentStroke | undefined): {
  stroke?: string;
  strokeWidth?: number;
  strokeDasharray?: string;
  strokeLinecap?: "round";
} {
  if (stroke === undefined) return {};
  const attrs: {
    stroke?: string;
    strokeWidth?: number;
    strokeDasharray?: string;
    strokeLinecap?: "round";
  } = {
    stroke: colorToCss(stroke.color),
    strokeWidth: stroke.widthPt,
  };
  if (stroke.style === "dashed") {
    attrs.strokeDasharray = `${stroke.widthPt * 3} ${stroke.widthPt * 2}`;
  } else if (stroke.style === "dotted") {
    attrs.strokeDasharray = `${stroke.widthPt * 0.1} ${stroke.widthPt * 2}`;
    attrs.strokeLinecap = "round";
  }
  return attrs;
}

function buildPathData(subpaths: readonly ContentSubpath[]): string {
  return subpaths
    .map((sp) => {
      let d = `M ${sp.start.xPt} ${sp.start.yPt}`;
      for (const seg of sp.segments) {
        if (seg.kind === "line") {
          d += ` L ${seg.to.xPt} ${seg.to.yPt}`;
        } else {
          d += ` C ${seg.control1.xPt} ${seg.control1.yPt} ${seg.control2.xPt} ${seg.control2.yPt} ${seg.to.xPt} ${seg.to.yPt}`;
        }
      }
      if (sp.closed) d += " Z";
      return d;
    })
    .join(" ");
}
