// The colour and matrix operand helpers, split from interpret.ts: gray/rgb/cmyk/generic colour construction from operand stacks and the 6-element affine matrix reader.
import type { Color as LayoutColor } from "document-schema.js";
import type { PdfObject } from "./objects";
import { numAt } from "./interpret";
export function grayColor(value: number): LayoutColor {
  return { r: value, g: value, b: value };
}

export function rgbColor(operands: readonly PdfObject[]): LayoutColor {
  return {
    r: numAt(operands, 0),
    g: numAt(operands, 1),
    b: numAt(operands, 2),
  };
}

// K is the fourth operand of the CMYK colour-setting operators (k/K/the 4-numeric-operand form of sc/SC/scn/SCN), 0-indexed.
const CMYK_K_INDEX = 3;

export function cmykColor(operands: readonly PdfObject[]): LayoutColor {
  const c = numAt(operands, 0);
  const m = numAt(operands, 1);
  const y = numAt(operands, 2);
  const k = numAt(operands, CMYK_K_INDEX);
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
}

// The generic sc/SC/scn/SCN operators set a colour in whatever space a prior `cs`/`CS` selected, which can be an arbitrary ICC/Indexed/Separation/Pattern resource — fully resolving that is out of v1 scope. This heuristic (dispatch purely on operand count) covers the overwhelming common case where the selected space is in fact DeviceGray/RGB/CMYK; a trailing pattern-name operand (SCN's own Pattern form) is left as `undefined`, meaning "leave the current colour unchanged," which is honest given a pattern fill has no single flat colour to report anyway.
// DeviceRGB and DeviceCMYK are distinguished purely by how many numeric operands a generic sc/SC/scn/SCN call carries, per the genericColor comment above.
const RGB_COMPONENT_COUNT = 3;
const CMYK_COMPONENT_COUNT = 4;

export function genericColor(
  operands: readonly PdfObject[],
): LayoutColor | undefined {
  const numericOperands = operands.filter((o) => o.kind === "number");
  if (numericOperands.length === 1) {
    return grayColor(numAt(numericOperands, 0));
  }
  if (numericOperands.length === RGB_COMPONENT_COUNT) {
    return rgbColor(numericOperands);
  }
  if (numericOperands.length === CMYK_COMPONENT_COUNT) {
    return cmykColor(numericOperands);
  }
  return undefined;
}

// The cm/Tm operators' own six operands, a b c d e f (ISO 32000-1 8.3.4 / 9.4.2): the last three (d, e, f) fall outside this rule's own ignored range (0-2).
