// -- Page furniture, per WPFF "D6 Header/Footer Functions" --
//
// The D6 group states a document's headers, footers, and watermarks. Each function names its body as the prefix ID of a General WP Text packet (type 0x08) -- the identical packet type a box's own text content rides -- and its non-deletable data is exactly two bytes, of which the first is the occurrence byte: bit 0 "does occur on odd pages", bit 1 "does occur on even pages" (bit 2 states a vertical-text watermark and bits 3/4 watermark display space, none of which the shared furniture model asks about).
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D6-HeaderFooter.htm

export const HEADER_FOOTER_GROUP = 0xd6;

// The SDK's own subfunction table: "0 Header A, 1 Header B, 2 Footer A, 3 Footer B, 4 Watermark A, 5 Watermark B". The A/B pair is WordPerfect's own two-slot-per-kind mechanism -- a page shows Header A until a Header B supersedes it -- which the shared furniture vocabulary does not carry: a slot holds one flow, and a second function claiming a slot a first already fills is reported rather than silently overwritten.
export const HEADER_A = 0x00;
export const HEADER_B = 0x01;
export const FOOTER_A = 0x02;
export const FOOTER_B = 0x03;
export const WATERMARK_A = 0x04;
export const WATERMARK_B = 0x05;

// The occurrence byte's own two bits the furniture model asks about.
const OCCURS_ON_ODD = 1 << 0;
const OCCURS_ON_EVEN = 1 << 1;

// What one D6 function claims: which furniture kind it is, and which of the shared vocabulary's three slots (default/even/first, WordprocessingML's own headerReference/@w:type values) its occurrence bits narrow onto. Odd-only is the default slot (the ordinary single-header document states exactly that); even-only is the even slot; both parities is the default slot too, since a flow occurring on every page IS the default. A function claiming neither parity is suppressed in its own file and claims nothing here. undefined answers watermark -- the one kind the vocabulary has no slot for (a watermark is neither header nor footer and owns no parity).
export interface WpdFurnitureClaim {
  readonly kind: "header" | "footer";
  readonly slot: "default" | "even";
}

export function readFurnitureClaim(
  subgroup: number,
  nonDeletable: Uint8Array,
): WpdFurnitureClaim | "watermark" | "none" {
  if (subgroup === WATERMARK_A || subgroup === WATERMARK_B) {
    return "watermark";
  }
  const kind =
    subgroup === HEADER_A || subgroup === HEADER_B
      ? ("header" as const)
      : subgroup === FOOTER_A || subgroup === FOOTER_B
        ? ("footer" as const)
        : undefined;
  if (kind === undefined) {
    return "none";
  }
  const occurrence = nonDeletable[0] ?? 0;
  const odd = (occurrence & OCCURS_ON_ODD) !== 0;
  const even = (occurrence & OCCURS_ON_EVEN) !== 0;
  if (!odd && !even) {
    return "none";
  }
  // Even-only is the even slot; odd-only and both-parities are the default slot, per the narrowing above.
  return { kind, slot: even && !odd ? "even" : "default" };
}
