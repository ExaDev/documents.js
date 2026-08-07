import type { FontSubstitution, LayoutFont } from 'document-schema.js';
import { describe, expect, it, vi } from 'vitest';
import { createFontRegistry } from './font-registry';
import { resolveVendoredSubstituteFamily } from './font-substitutes';
import { resolveStandardFont } from './fonts';

function font(family: string, weight: LayoutFont['weight'] = 'normal', style: LayoutFont['style'] = 'normal'): LayoutFont {
  return { family, weight, style };
}

describe('createFontRegistry with no options', () => {
  it('resolves every family/weight/style combination identically to calling resolveStandardFont directly -- byte-identical to today\'s behavior', () => {
    const registry = createFontRegistry();
    const cases: readonly [string, boolean, boolean][] = [
      ['Arial', false, false],
      ['Times New Roman', true, false],
      ['Courier New', false, true],
      ['Aptos', true, true],
      ['SomeCompletelyUnknownFace', false, false],
      // Calibri/Cambria are also in the vendored substitute table -- with no options, `substitutes` defaults to 'vendored', so a real FontRegistry.resolve for these would NOT match resolveStandardFont's own output (it would embed Carlito/Caladea instead, see the dedicated tests below). Proving byte-identical fallback here therefore needs substitutes disabled explicitly for exactly these two families.
    ];
    for (const [family, bold, italic] of cases) {
      const direct = resolveStandardFont(family, bold, italic);
      const resolved = registry.resolve(font(family, bold ? 'bold' : 'normal', italic ? 'italic' : 'normal'));
      expect(resolved).toEqual({ kind: 'standard', standardName: direct.standardName, matched: direct.matched });
    }
  });

  it('resolves Calibri/Cambria identically to resolveStandardFont when the vendored substitute table is explicitly disabled', () => {
    const registry = createFontRegistry({ substitutes: 'none' });
    for (const [family, bold, italic] of [
      ['Calibri', false, false],
      ['Cambria', true, true],
    ] as const) {
      const direct = resolveStandardFont(family, bold, italic);
      const resolved = registry.resolve(font(family, bold ? 'bold' : 'normal', italic ? 'italic' : 'normal'));
      expect(resolved).toEqual({ kind: 'standard', standardName: direct.standardName, matched: direct.matched });
    }
  });

  it('memoises: resolving the same LayoutFont twice returns the identical ResolvedFace object', () => {
    const registry = createFontRegistry();
    const first = registry.resolve(font('Arial'));
    const second = registry.resolve(font('Arial'));
    expect(second).toBe(first);
  });
});

describe('createFontRegistry vendored substitute table (step 4)', () => {
  it('resolves Calibri to an embedded Carlito face', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve(font('Calibri'));
    expect(resolved.kind).toBe('embedded');
    if (resolved.kind !== 'embedded') {
      throw new Error('expected an embedded face');
    }
    expect(resolved.face.postScriptName.toLowerCase()).toContain('carlito');
  });

  it('resolves a bold-italic Calibri run to the bold-italic Carlito face', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve(font('Calibri', 'bold', 'italic'));
    expect(resolved.kind).toBe('embedded');
    if (resolved.kind !== 'embedded') {
      throw new Error('expected an embedded face');
    }
    const name = resolved.face.postScriptName.toLowerCase();
    expect(name).toContain('carlito');
    expect(name).toContain('bold');
    expect(name).toContain('italic');
  });

  it('resolves Cambria to an embedded Caladea face', () => {
    const registry = createFontRegistry();
    const resolved = registry.resolve(font('Cambria'));
    expect(resolved.kind).toBe('embedded');
    if (resolved.kind !== 'embedded') {
      throw new Error('expected an embedded face');
    }
    expect(resolved.face.postScriptName.toLowerCase()).toContain('caladea');
  });

  it('reports a vendored-substitute FontSubstitution via onSubstitution', () => {
    const onSubstitution = vi.fn<(substitution: FontSubstitution) => void>();
    const registry = createFontRegistry({ onSubstitution });
    registry.resolve(font('Calibri'));
    expect(onSubstitution).toHaveBeenCalledWith({
      requestedFamily: 'Calibri',
      requestedBold: false,
      requestedItalic: false,
      reason: 'vendored-substitute',
      resolvedFamily: 'carlito',
    });
  });

  it('never fires onSubstitution for a family that falls straight through to the standard-14 baseline', () => {
    const onSubstitution = vi.fn<(substitution: FontSubstitution) => void>();
    const registry = createFontRegistry({ onSubstitution });
    registry.resolve(font('Arial'));
    expect(onSubstitution).not.toHaveBeenCalled();
  });

  it('does not resolve "Cambria Math" to Caladea -- the vendored table is an exact normalized-name match, never a prefix match', () => {
    // Direct proof against the table itself: 'cambriamath' is a materially different normalized key from 'cambria'.
    expect(resolveVendoredSubstituteFamily('Cambria Math')).toBeUndefined();

    const registry = createFontRegistry();
    const resolved = registry.resolve(font('Cambria Math'));
    expect(resolved.kind).toBe('standard');
    if (resolved.kind !== 'standard') {
      throw new Error('expected the standard-14 fallback');
    }
    // 'cambriamath' matches none of fonts.ts's own FAMILY_BY_NORMALIZED_NAME entries either (not 'cambria', no 'mono'/'serif' substring), so it falls all the way through to the unmatched default -- proving this is a genuine miss, not an accidental match on a different table.
    expect(resolved).toEqual({ kind: 'standard', standardName: resolveStandardFont('Cambria Math', false, false).standardName, matched: false });
  });

  it('does not extend a vendored mapping from one family to an unrelated one sharing a prefix (Aptos has no vendored substitute; AptosDisplay must not borrow it even if Aptos gained one later)', () => {
    expect(resolveVendoredSubstituteFamily('Aptos')).toBeUndefined();
    expect(resolveVendoredSubstituteFamily('AptosDisplay')).toBeUndefined();

    const registry = createFontRegistry();
    const resolved = registry.resolve(font('Aptos'));
    expect(resolved).toEqual({ kind: 'standard', standardName: resolveStandardFont('Aptos', false, false).standardName, matched: true });
  });
});

describe('createFontRegistry with substitutes: none', () => {
  it('never consults the vendored table, even for Calibri', () => {
    const registry = createFontRegistry({ substitutes: 'none' });
    const resolved = registry.resolve(font('Calibri'));
    expect(resolved.kind).toBe('standard');
  });
});
