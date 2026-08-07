import type { MathBox, MathLayoutItem, PositionedFormula } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { collectUsedGlyphs, writeFormulaContentStream } from './math-content-write';
import { loadMathFont } from './math-font';

const BLACK = { r: 0, g: 0, b: 0 };
const RESOURCE = 'MF';

function box(items: readonly MathLayoutItem[], heightPt: number): MathBox {
  return { widthPt: 10, heightPt, ascentPt: heightPt, descentPt: 0, items };
}

function positioned(boxValue: MathBox): PositionedFormula {
  return { pageIndex: 0, xPt: 100, yPt: 200, box: boxValue };
}

function write(formula: PositionedFormula): string {
  return new TextDecoder().decode(writeFormulaContentStream([formula], { font: loadMathFont().font, resourceName: RESOURCE }));
}

// Two arbitrary glyph IDs standing in for a real construction's own parts -- what this module does with a placement is independent of which glyph it names, and the real, font-derived IDs are asserted where they are actually produced (math-stretch.test.ts, and documents.js's own layout tests).
const LOWER_HOOK = 4862;
const UPPER_HOOK = 4860;

describe('writeFormulaContentStream, assembled stretchy glyphs', () => {
  it('shows each placement as its own glyph-ID CID at its own computed position', () => {
    const content = write(
      positioned(
        box(
          [
            {
              kind: 'assembled-glyphs',
              text: '(',
              sizePt: 12,
              color: BLACK,
              placements: [
                { glyphId: LOWER_HOOK, xPt: 0, yPt: 40 },
                { glyphId: UPPER_HOOK, xPt: 0, yPt: 10 },
              ],
            },
          ],
          50,
        ),
      ),
    );

    // Box-local y-down against a 50pt-tall box placed with its bottom-left at (100, 200): a placement 40pt down from the box's own top sits 10pt up from its bottom, i.e. at PDF y = 210.
    expect(content).toContain(`1 0 0 1 100 210 Tm\n<${LOWER_HOOK.toString(16).padStart(4, '0')}> Tj`);
    expect(content).toContain(`1 0 0 1 100 240 Tm\n<${UPPER_HOOK.toString(16).padStart(4, '0')}> Tj`);
    // One text object per placement, each selecting the embedded math font at the item's own size.
    expect(content.match(/BT\n/g)).toHaveLength(2);
    expect(content.match(/\/MF 12 Tf\n/g)).toHaveLength(2);
  });

  it('wraps the whole construction in an /ActualText span naming the operator it stands for', () => {
    const content = write(
      positioned(box([{ kind: 'assembled-glyphs', text: '(', sizePt: 12, color: BLACK, placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }] }], 50)),
    );
    // UTF-16BE with the byte-order mark that marks a PDF text string as Unicode: FEFF then U+0028.
    expect(content).toContain('/Span <</ActualText <feff0028> >> BDC\n');
    expect(content.endsWith('EMC\n')).toBe(true);
    expect(content.indexOf('BDC')).toBeLessThan(content.indexOf('BT'));
    expect(content.indexOf('ET')).toBeLessThan(content.indexOf('EMC'));
  });

  it('encodes a supplementary-plane operator in /ActualText as a real surrogate pair', () => {
    const content = write(
      positioned(box([{ kind: 'assembled-glyphs', text: '\u{1D400}', sizePt: 12, color: BLACK, placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }] }], 50)),
    );
    expect(content).toContain('/Span <</ActualText <feffd835dc00> >> BDC\n');
  });

  it('emits nothing at all for a construction with no placements', () => {
    expect(write(positioned(box([{ kind: 'assembled-glyphs', text: '(', sizePt: 12, color: BLACK, placements: [] }], 50)))).toBe('');
  });
});

describe('collectUsedGlyphs', () => {
  it('collects an assembled construction\'s own glyph IDs with no code point, since they have none', () => {
    const used = collectUsedGlyphs(
      [
        positioned(
          box(
            [
              {
                kind: 'assembled-glyphs',
                text: '(',
                sizePt: 12,
                color: BLACK,
                placements: [
                  { glyphId: LOWER_HOOK, xPt: 0, yPt: 0 },
                  { glyphId: UPPER_HOOK, xPt: 0, yPt: 0 },
                ],
              },
            ],
            50,
          ),
        ),
      ],
      loadMathFont().font,
    );
    expect([...used.keys()].sort((a, b) => a - b)).toEqual([UPPER_HOOK, LOWER_HOOK].sort((a, b) => a - b));
    expect(used.get(LOWER_HOOK)).toBeUndefined();
    expect(used.has(LOWER_HOOK)).toBe(true);
  });

  it('still resolves an ordinary glyph run to its own code point, and merges both kinds into one map', () => {
    const font = loadMathFont().font;
    const used = collectUsedGlyphs(
      [
        positioned(
          box(
            [
              { kind: 'glyphs', xPt: 0, yPt: 0, text: 'x', sizePt: 12, color: BLACK },
              { kind: 'assembled-glyphs', text: '(', sizePt: 12, color: BLACK, placements: [{ glyphId: LOWER_HOOK, xPt: 0, yPt: 0 }] },
            ],
            50,
          ),
        ),
      ],
      font,
    );
    const latinX = font.glyphId(0x78);
    expect(latinX).toBeDefined();
    expect(used.get(latinX!)).toBe(0x78);
    expect(used.get(LOWER_HOOK)).toBeUndefined();
    expect(used.size).toBe(2);
  });

  it("gives a glyph its code point regardless of which kind of item is encountered first", () => {
    const font = loadMathFont().font;
    // The LEFT PARENTHESIS LOWER HOOK is one of the few assembly pieces that DOES have a code point of its own (U+239D, see math-stretch.test.ts), so a document can genuinely draw it both as an assembly piece and as ordinary text.
    const hook = font.glyphId(0x239d);
    expect(hook).toBeDefined();
    const assemblyFirst: MathLayoutItem[] = [
      { kind: 'assembled-glyphs', text: '(', sizePt: 12, color: BLACK, placements: [{ glyphId: hook!, xPt: 0, yPt: 0 }] },
      { kind: 'glyphs', xPt: 0, yPt: 0, text: '⎝', sizePt: 12, color: BLACK },
    ];
    expect(collectUsedGlyphs([positioned(box(assemblyFirst, 50))], font).get(hook!)).toBe(0x239d);
    expect(collectUsedGlyphs([positioned(box([...assemblyFirst].reverse(), 50))], font).get(hook!)).toBe(0x239d);
  });
});
