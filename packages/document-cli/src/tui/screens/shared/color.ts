import { rgbHexToColor, type LayoutColor } from "documents.js";

// documents.js re-exports document-schema.js's `rgbHexToColor` (hex string -> {r,g,b} floats in [0,1]) but not its own inverse `colorToRgbHex`, so the one direction this TUI additionally needs -- rendering a run's already-decoded colour back as a hex string for Ink's `Text color` prop -- is restated locally here, matching that function's own algorithm (round each float channel to a byte, no clamping: every colour this TUI ever converts either came from `rgbHexToColor` itself or from a real document's own in-range colour data).
const HEX_BYTE_MAX = 255;

function toHexByte(component: number): string {
  return Math.round(component * HEX_BYTE_MAX)
    .toString(16)
    .padStart(2, "0");
}

export function layoutColorToHex(color: LayoutColor): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

// Mirrors `rgbHexToColor`'s own validation pattern exactly so a caller can check validity without provoking the thrown error that function raises for anything that doesn't match -- useful for live-typed input, where most intermediate keystrokes are not yet a complete hex colour.
const HEX_COLOR_INPUT_PATTERN = /^#?[0-9a-fA-F]{6}$/u;

export function isValidHexColorInput(input: string): boolean {
  return HEX_COLOR_INPUT_PATTERN.test(input.trim());
}

export function parseHexColorInput(input: string): LayoutColor | undefined {
  const trimmed = input.trim();
  return isValidHexColorInput(trimmed) ? rgbHexToColor(trimmed) : undefined;
}
