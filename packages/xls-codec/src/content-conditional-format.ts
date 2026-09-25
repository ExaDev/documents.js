// The conditional-format mapping family split from content.ts: base BIFF8 and CF12 rules both resolve their colours against the workbook's own palette here, the one layer that holds it. They live together because they answer the same question at the same boundary (a raw rule structure into document-schema.js's ContentSheetConditionalFormat) and share the palette and style resolution between them.

import type {
  Color,
  ContentSheetConditionalFormat,
  ContentSheetConditionalFormatValue,
  ContentSheetConditionalFormatStyle,
} from "document-schema.js";

import {
  applyTint,
  resolveFillBackground,
  resolveIcvColor,
} from "./biff/xf-colors";
import type {
  RawConditionalFormat,
  RawConditionalFormatStyle,
} from "./workbook/conditional-format";
import type {
  RawCfColor,
  RawColorScaleFormat,
  RawConditionalFormat12,
} from "./workbook/conditional-format-12";

// Base BIFF8 conditional formatting only ever produces a 'cellIs' rule (ExaDev/documents.js#1102's own scope). icv colour resolution is deferred to here, not workbook/conditional-format.ts, matching how a regular cell's own fill/border already resolve through globals.palette at this same layer (mapCellDecoration below).
export function mapConditionalFormats(
  raw: readonly RawConditionalFormat[],
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormat[] {
  return raw.map((format) => {
    const style = mapConditionalFormatStyle(format.style, palette);
    return {
      type: "cellIs" as const,
      ranges: format.ranges,
      operator: format.operator,
      formula1: format.formula1,
      ...(format.formula2 !== undefined ? { formula2: format.formula2 } : {}),
      ...(style !== undefined ? { style } : {}),
    };
  });
}

// CF12's colour scale/data bar/icon set/filter-template rules. A rule whose own colour cannot be resolved (an automatic or theme colour reference, this package has no BIFF8 Theme reader) is dropped whole rather than promoted with a missing or wrong colour, mirroring the same "narrow rather than guess" boundary the base CF/DXFN reading above already draws.
export function mapConditionalFormats12(
  raw: readonly RawConditionalFormat12[],
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormat[] {
  const results: ContentSheetConditionalFormat[] = [];
  for (const format of raw) {
    const common = {
      ranges: format.ranges,
      priority: format.priority,
      ...(format.stopIfTrue ? { stopIfTrue: true } : {}),
    };
    if (format.kind === "colorScale") {
      const stops = mapColorScaleStops(format.stops, palette);
      if (stops === undefined) {
        continue;
      }
      results.push({ type: "colorScale", stops, ...common });
      continue;
    }
    if (format.kind === "dataBar") {
      const color = mapCfColor(format.color, palette);
      if (color === undefined) {
        continue;
      }
      results.push({
        type: "dataBar",
        min: format.min,
        max: format.max,
        color,
        ...(format.showValue ? {} : { showValue: false }),
        ...common,
      });
      continue;
    }
    if (format.kind === "iconSet") {
      results.push({
        type: "iconSet",
        iconSetType: format.iconSetType,
        thresholds: [...format.thresholds],
        ...(format.reverse ? { reverse: true } : {}),
        ...(format.showValue ? {} : { showValue: false }),
        ...common,
      });
      continue;
    }
    if (format.kind === "top10") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "top10",
        rank: format.rank,
        ...(format.percent ? { percent: true } : {}),
        ...(format.bottom ? { bottom: true } : {}),
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (format.kind === "aboveAverage") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "aboveAverage",
        ...(format.aboveAverage ? {} : { aboveAverage: false }),
        ...(format.equalAverage ? { equalAverage: true } : {}),
        ...(format.stdDev !== undefined ? { stdDev: format.stdDev } : {}),
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (format.kind === "timePeriod") {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: "timePeriod",
        timePeriod: format.timePeriod,
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    if (
      format.kind === "containsText" ||
      format.kind === "notContainsText" ||
      format.kind === "beginsWith" ||
      format.kind === "endsWith"
    ) {
      const style = mapConditionalFormatStyle(format.style, palette);
      results.push({
        type: format.kind,
        text: format.text,
        ...(style !== undefined ? { style } : {}),
        ...common,
      });
      continue;
    }
    const style = mapConditionalFormatStyle(format.style, palette);
    results.push({
      type: format.kind,
      ...(style !== undefined ? { style } : {}),
      ...common,
    });
  }
  return results;
}

// CFColor's own tint applies to whichever base colour xclrType named, indexed or RGB alike, so it is applied here, once, after resolving that base colour — not inside conditional-format-12.ts's own readCfColor, which has no palette to resolve an indexed colour against in the first place.
function mapCfColor(
  raw: RawCfColor,
  palette: readonly Color[] | undefined,
): Color | undefined {
  const base =
    raw.kind === "rgb" ? raw.color : resolveIcvColor(raw.icv, palette);
  return base === undefined ? undefined : applyTint(base, raw.tint);
}

function mapColorScaleStops(
  stops: RawColorScaleFormat["stops"],
  palette: readonly Color[] | undefined,
): { value: ContentSheetConditionalFormatValue; color: Color }[] | undefined {
  const mapped: { value: ContentSheetConditionalFormatValue; color: Color }[] =
    [];
  for (const stop of stops) {
    const color = mapCfColor(stop.color, palette);
    if (color === undefined) {
      return undefined;
    }
    mapped.push({ value: stop.value, color });
  }
  return mapped;
}

function mapConditionalFormatStyle(
  raw: RawConditionalFormatStyle | undefined,
  palette: readonly Color[] | undefined,
): ContentSheetConditionalFormatStyle | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const textColor =
    raw.fontColorIcv === undefined
      ? undefined
      : resolveIcvColor(raw.fontColorIcv, palette);
  // ContentSheetConditionalFormatStyleSchema.background is a plain colour (the two properties actually observed on a real dxf, per that schema's own top comment); resolveFillBackground's own richer solid/pattern ContentCellFill is narrowed to the 'solid' case only, the same narrowing odf.js's own conditional-format.ts already applies for the identical schema field.
  const fill =
    raw.fill === undefined
      ? undefined
      : resolveFillBackground(
          raw.fill.fillPattern,
          raw.fill.fillForegroundIcv,
          raw.fill.fillBackgroundIcv,
          palette,
        );
  const background = fill?.kind === "solid" ? fill.color : undefined;
  if (textColor === undefined && background === undefined) {
    return undefined;
  }
  return {
    ...(textColor !== undefined ? { textColor } : {}),
    ...(background !== undefined ? { background } : {}),
  };
}
