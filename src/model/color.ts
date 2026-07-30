import { z } from 'zod';

// sRGB components in 0..1 -- PDF's own colour-operator domain (rg/RG/sc/SC take 0..1 floats), so no scale factor is needed at the PDF writer boundary and none can be forgotten at the reader's.
export const LayoutColorSchema = z.object({
  r: z.number().min(0).max(1),
  g: z.number().min(0).max(1),
  b: z.number().min(0).max(1),
});
export type LayoutColor = z.infer<typeof LayoutColorSchema>;

export const COLOR_BLACK: LayoutColor = { r: 0, g: 0, b: 0 };

const HEX_COLOR_PATTERN = /^#?([0-9a-fA-F]{6})$/;
const HEX_BYTE_MAX = 255;

// Parses a 6-digit hex colour (OOXML's w:color/@w:val, a:srgbClr/@val), with or without a leading '#', into a LayoutColor. Throws on malformed input rather than substituting a default -- callers at the OOXML boundary are expected to have already validated the attribute is present.
export function rgbHexToColor(hex: string): LayoutColor {
  const match = HEX_COLOR_PATTERN.exec(hex);
  if (match === null) {
    throw new Error(`not a 6-digit hex colour: ${hex}`);
  }
  const digits = match[1];
  if (digits === undefined) {
    throw new Error(`not a 6-digit hex colour: ${hex}`);
  }
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return { r: r / HEX_BYTE_MAX, g: g / HEX_BYTE_MAX, b: b / HEX_BYTE_MAX };
}

function toHexByte(component: number): string {
  const byte = Math.round(component * HEX_BYTE_MAX);
  return byte.toString(16).padStart(2, '0');
}

// The exact inverse of rgbHexToColor, rounding each component to the nearest byte; always returns a lowercase 6-digit hex string with no leading '#'.
export function colorToRgbHex(color: LayoutColor): string {
  return `${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}
