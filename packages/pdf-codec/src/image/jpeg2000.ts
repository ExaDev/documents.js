import type { Jp2ChannelDefinition, Jp2ColourSpace } from './jp2-boxes';
import { parseJp2Container } from './jp2-boxes';
import type { Jpeg2000CodingDefaults, Jpeg2000CodingStyle, Jpeg2000Codestream, Jpeg2000HeaderOverrides, Jpeg2000ProgressionOrder, Jpeg2000Quantization, Jpeg2000QuantizationStyle, Jpeg2000Transform } from './jpeg2000-codestream';
import { parseJpeg2000Codestream } from './jpeg2000-codestream';
import { inverseDwt53Level, inverseDwt97Level } from './jpeg2000-dwt';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';
import { decodeJpeg2000CodeBlock } from './jpeg2000-t1';
import type { Jpeg2000Subband, Jpeg2000TileGeometry } from './jpeg2000-t2';
import { buildPacketSequence, buildTileGeometry, readTilePackets, subbandGainLog2, tileHasSubdividedPrecincts } from './jpeg2000-t2';

// A hand-written JPEG 2000 decoder (ISO/IEC 15444-1, ITU-T T.800), reading both the JP2 file format and the bare codestream a PDF /JPXDecode filter may carry either of.
//
// The scope is deliberately narrow and is enforced by refusal, never by approximation. readJpeg2000Metadata parses the JP2 boxes and the whole codestream header for ANY conforming codestream, and reports what it found together with an honest verdict on whether the pixels themselves are decodable here. decodeJpeg2000 then decodes only the reversible 5-3 path: any number of tiles, quality layers, components, decomposition levels and precincts, LRCP or RLCP progression (and the position-driven orders when every resolution holds a single precinct), with or without the reversible component transform. Everything else -- the irreversible 9-7 wavelet above all, but also sub-sampled components, regions of interest, progression-order changes, packed packet headers, arithmetic-coder bypass and per-pass termination -- raises Jpeg2000UnsupportedError naming itself, because a decoder that guessed at any of them would return a plausible-looking image made of wrong pixels.
//
// The entropy layer is src/image/jpeg2000-t1.ts, the packet layer src/image/jpeg2000-t2.ts, the wavelet src/image/jpeg2000-dwt.ts, and the codestream syntax src/image/jpeg2000-codestream.ts. Like its src/image/ siblings this module has zero PDF knowledge.

export interface Jpeg2000ComponentMetadata {
  readonly bitDepth: number;
  readonly signed: boolean;
  readonly dx: number;
  readonly dy: number;
}

export interface Jpeg2000Metadata {
  readonly width: number;
  readonly height: number;
  readonly components: readonly Jpeg2000ComponentMetadata[];
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
  readonly tilePartCount: number;
  readonly decompositionLevels: number;
  readonly transform: Jpeg2000Transform;
  readonly progressionOrder: Jpeg2000ProgressionOrder;
  readonly layers: number;
  readonly codeBlockWidth: number;
  readonly codeBlockHeight: number;
  readonly codeBlockStyle: number;
  readonly quantizationStyle: Jpeg2000QuantizationStyle;
  readonly guardBits: number;
  readonly multipleComponentTransform: boolean;
  readonly usesSopMarkers: boolean;
  readonly usesEphMarkers: boolean;
  // Present only for a JP2 file; a bare codestream carries no colour specification of its own.
  readonly colourSpace?: Jp2ColourSpace;
  readonly hasIccProfile: boolean;
  readonly channelDefinitions: readonly Jp2ChannelDefinition[];
  readonly comments: readonly string[];
  // True when the codestream ends without an EOC marker, which is what a clipped stream looks like.
  readonly truncated: boolean;
  // Whether decodeJpeg2000 can decode this codestream's pixels, and if not, exactly why.
  readonly decodable: boolean;
  readonly undecodableReason?: string;
}

export interface Jpeg2000DecodeOptions {
  readonly onWarning?: (message: string) => void;
}

export interface Jpeg2000Image {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly signed: boolean;
  // One entry per component, each width*height samples in raster order, with the component transform undone and the DC level shift of G.1.2 applied.
  readonly components: readonly Int32Array[];
  readonly colourSpace?: Jp2ColourSpace;
  readonly channelDefinitions: readonly Jp2ChannelDefinition[];
}

// The precedence ISO/IEC 15444-1 A.6.2/A.6.5 defines for one tile-component: a tile-part COC beats a tile-part COD, which beats a main-header COC, which beats the main-header COD.
function resolveCoding(main: Jpeg2000HeaderOverrides, tile: Jpeg2000HeaderOverrides | undefined, component: number): Jpeg2000CodingStyle {
  const tileCoc = tile?.coc.get(component);
  if (tileCoc !== undefined) {
    return tileCoc;
  }
  if (tile?.cod !== undefined) {
    return tile.cod;
  }
  const mainCoc = main.coc.get(component);
  if (mainCoc !== undefined) {
    return mainCoc;
  }
  if (main.cod === undefined) {
    throw new Jpeg2000ParseError('no COD marker defines a coding style for this codestream');
  }
  return main.cod;
}

function resolveQuantization(main: Jpeg2000HeaderOverrides, tile: Jpeg2000HeaderOverrides | undefined, component: number): Jpeg2000Quantization {
  const tileQcc = tile?.qcc.get(component);
  if (tileQcc !== undefined) {
    return tileQcc;
  }
  if (tile?.qcd !== undefined) {
    return tile.qcd;
  }
  const mainQcc = main.qcc.get(component);
  if (mainQcc !== undefined) {
    return mainQcc;
  }
  if (main.qcd === undefined) {
    throw new Jpeg2000ParseError('no QCD marker defines a quantization for this codestream');
  }
  return main.qcd;
}

function tileDefaults(main: Jpeg2000HeaderOverrides, tile: Jpeg2000HeaderOverrides | undefined): Jpeg2000CodingDefaults {
  if (tile?.cod !== undefined) {
    return tile.cod;
  }
  if (main.cod === undefined) {
    throw new Jpeg2000ParseError('no COD marker defines a coding style for this codestream');
  }
  return main.cod;
}

// The one place the scope of this decoder is stated. Returns undefined when the codestream is decodable here, or the reason it is not.
function undecodableReason(codestream: Jpeg2000Codestream): string | undefined {
  const main = codestream.main;
  const cod = main.cod;
  if (cod === undefined) {
    return 'the codestream carries no COD marker';
  }
  const headers: Jpeg2000HeaderOverrides[] = [main, ...codestream.tileParts.map((part) => part.header)];
  for (const header of headers) {
    if (header.hasProgressionChanges) {
      return 'the codestream carries a POC marker (progression order change), which this decoder does not follow';
    }
    if (header.hasRegionOfInterest) {
      return 'the codestream carries an RGN marker (region of interest), whose coefficient upshift this decoder does not undo';
    }
    if (header.hasPackedPacketHeaders) {
      return 'the codestream carries a PPT marker (packed packet headers in the tile-part header), an organisation this decoder does not reassemble';
    }
  }
  for (let c = 0; c < codestream.siz.components.length; c++) {
    const size = codestream.siz.components[c];
    if (size === undefined) {
      continue;
    }
    if (size.dx !== 1 || size.dy !== 1) {
      return `component ${String(c)} is sub-sampled (${String(size.dx)}x${String(size.dy)}), which this decoder does not resample`;
    }
    for (const header of headers) {
      const style = resolveCoding(main, header === main ? undefined : header, c);
      if ((style.codeBlockStyle & 0x01) !== 0) {
        return 'the code-block style enables selective arithmetic coding bypass, which this decoder does not read';
      }
      if ((style.codeBlockStyle & 0x04) !== 0) {
        return 'the code-block style terminates the arithmetic coder on every coding pass, which this decoder does not read';
      }
    }
  }
  // B.12: the three position-driven progression orders iterate the reference grid rather than a precinct index, which only collapses to a plain loop when every resolution level holds a single precinct. Checked here, tile by tile against that tile's own coding style, so `decodable` says exactly what decodeJpeg2000 will do rather than approximately.
  for (const part of codestream.tileParts) {
    if (part.partIndex !== 0) {
      continue;
    }
    const defaults = part.header.cod ?? cod;
    if (defaults.progressionOrder === 'LRCP' || defaults.progressionOrder === 'RLCP') {
      continue;
    }
    const numTilesWide = Math.max(Math.ceil((codestream.siz.xsiz - codestream.siz.xtosiz) / codestream.siz.xtsiz), 1);
    const codingPerComponent = codestream.siz.components.map((_, c) => resolveCoding(main, part.header, c));
    if (tileHasSubdividedPrecincts(codestream.siz, part.tileIndex % numTilesWide, Math.floor(part.tileIndex / numTilesWide), codingPerComponent)) {
      return `progression order ${defaults.progressionOrder} is only decoded here when every resolution level holds a single precinct, and this codestream subdivides at least one of them`;
    }
  }

  const first = codestream.siz.components[0];
  if (first !== undefined) {
    for (const size of codestream.siz.components) {
      if (size.bitDepth !== first.bitDepth || size.signed !== first.signed) {
        return 'the codestream mixes component bit depths or signedness, which this decoder does not combine into one image';
      }
    }
    if (first.bitDepth > 31) {
      return `a component bit depth of ${String(first.bitDepth)} exceeds what this decoder's own 32-bit sample arithmetic can hold`;
    }
  }
  return undefined;
}

export function readJpeg2000Metadata(data: Uint8Array<ArrayBuffer>): Jpeg2000Metadata {
  const container = parseJp2Container(data);
  const codestream = parseJpeg2000Codestream(container.codestream);
  const cod = codestream.main.cod;
  const qcd = codestream.main.qcd;
  if (cod === undefined || qcd === undefined) {
    throw new Jpeg2000ParseError('the codestream main header is missing its COD or QCD marker');
  }
  const reason = undecodableReason(codestream);
  const siz = codestream.siz;
  const base: Omit<Jpeg2000Metadata, 'colourSpace' | 'undecodableReason'> = {
    width: siz.xsiz - siz.xosiz,
    height: siz.ysiz - siz.yosiz,
    components: siz.components.map((component) => ({ bitDepth: component.bitDepth, signed: component.signed, dx: component.dx, dy: component.dy })),
    tileWidth: siz.xtsiz,
    tileHeight: siz.ytsiz,
    tilesWide: codestream.numTilesWide,
    tilesHigh: codestream.numTilesHigh,
    tilePartCount: codestream.tileParts.length,
    decompositionLevels: cod.decompositionLevels,
    transform: cod.transform,
    progressionOrder: cod.progressionOrder,
    layers: cod.layers,
    codeBlockWidth: 2 ** cod.codeBlockWidthExp,
    codeBlockHeight: 2 ** cod.codeBlockHeightExp,
    codeBlockStyle: cod.codeBlockStyle,
    quantizationStyle: qcd.style,
    guardBits: qcd.guardBits,
    multipleComponentTransform: cod.multipleComponentTransform,
    usesSopMarkers: cod.useSop,
    usesEphMarkers: cod.useEph,
    hasIccProfile: container.iccProfile !== undefined,
    channelDefinitions: container.channelDefinitions,
    comments: codestream.comments,
    truncated: codestream.truncated,
    decodable: reason === undefined,
  };
  return {
    ...base,
    ...(container.colourSpace !== undefined ? { colourSpace: container.colourSpace } : {}),
    ...(reason !== undefined ? { undecodableReason: reason } : {}),
  };
}

function concatTilePartData(codestream: Jpeg2000Codestream, tileIndex: number): Uint8Array<ArrayBuffer> {
  const parts = codestream.tileParts.filter((part) => part.tileIndex === tileIndex).sort((a, b) => a.partIndex - b.partIndex);
  let total = 0;
  for (const part of parts) {
    total += part.dataEnd - part.dataStart;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(codestream.bytes.subarray(part.dataStart, part.dataEnd), offset);
    offset += part.dataEnd - part.dataStart;
  }
  return out;
}

// Reversible coefficients come out of tier-1 at twice their own scale (see Jpeg2000CodeBlockResult), so halving with truncation toward zero recovers the exact integer whenever every bit-plane was decoded, and the mid-point of the remaining interval when the stream was truncated.
function halveTowardZero(value: number): number {
  return value < 0 ? -((-value) >> 1) : value >> 1;
}

// E.1.1 equation E-3: the quantization step for one subband, from its transmitted exponent and mantissa against the subband's own nominal dynamic range (the component's bit depth plus the base-2 gain of that subband's synthesis, Table E.1). A codestream that transmits no mantissa at all leaves the fractional term at one, which is what a missing SPqcd mantissa field means rather than something to guess at.
function quantizationStep(band: Jpeg2000Subband, componentBitDepth: number): number {
  const nominalRange = componentBitDepth + subbandGainLog2(band.type);
  return 2 ** (nominalRange - band.stepSize.exponent) * (1 + band.stepSize.mantissa / 2048);
}

// Runs tier-1 over every code-block of one subband and hands each decoded block to `place`, which is the only part that differs between the reversible and irreversible paths.
function decodeSubbandBlocks(band: Jpeg2000Subband, codeBlockStyle: number, data: Uint8Array<ArrayBuffer>, place: (x: number, y: number, value: number) => void): void {
  for (const precinct of band.precincts) {
    for (const block of precinct.codeBlocks) {
      const blockWidth = block.x1 - block.x0;
      const blockHeight = block.y1 - block.y0;
      if (blockWidth <= 0 || blockHeight <= 0 || block.passes === 0) {
        continue;
      }
      let coded = new Uint8Array(0);
      if (block.chunks.length === 1) {
        const chunk = block.chunks[0];
        coded = chunk === undefined ? coded : data.subarray(chunk.start, chunk.end);
      } else if (block.chunks.length > 1) {
        // A code-block that contributed to several quality layers has its segments spread across those layers' packets; the arithmetic coder reads them as one continuous stream.
        let total = 0;
        for (const chunk of block.chunks) {
          total += chunk.end - chunk.start;
        }
        const joined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of block.chunks) {
          joined.set(data.subarray(chunk.start, chunk.end), offset);
          offset += chunk.end - chunk.start;
        }
        coded = joined;
      }
      const { values } = decodeJpeg2000CodeBlock({
        width: blockWidth,
        height: blockHeight,
        subband: band.type,
        zeroBitPlanes: block.zeroBitPlanes,
        maxBitPlanes: band.maxBitPlanes,
        totalPasses: block.passes,
        codeBlockStyle,
        data: coded,
      });
      for (let y = 0; y < blockHeight; y++) {
        for (let x = 0; x < blockWidth; x++) {
          place(block.x0 - band.x0 + x, block.y0 - band.y0 + y, values[y * blockWidth + x] ?? 0);
        }
      }
    }
  }
}

function decodeReversibleTileComponent(tile: Jpeg2000TileGeometry, componentIndex: number, data: Uint8Array<ArrayBuffer>): Int32Array {
  const component = tile.components[componentIndex];
  if (component === undefined) {
    throw new Jpeg2000ParseError(`the tile has no component ${String(componentIndex)}`);
  }
  const bands = new Map<string, Int32Array>();
  for (const resolution of component.resolutions) {
    for (const band of resolution.subbands) {
      const width = band.x1 - band.x0;
      const samples = new Int32Array(Math.max(width * (band.y1 - band.y0), 0));
      decodeSubbandBlocks(band, component.coding.codeBlockStyle, data, (x, y, value) => {
        samples[y * width + x] = halveTowardZero(value);
      });
      bands.set(`${String(resolution.index)}:${band.type}`, samples);
    }
  }
  // The reconstruction starts from the lowest resolution level's LL band and folds in one level's HL/LH/HH at a time.
  let current = bands.get('0:LL') ?? new Int32Array(0);
  for (let r = 1; r < component.resolutions.length; r++) {
    const resolution = component.resolutions[r];
    if (resolution === undefined) {
      break;
    }
    current = inverseDwt53Level(
      {
        ll: current,
        hl: bands.get(`${String(r)}:HL`) ?? new Int32Array(0),
        lh: bands.get(`${String(r)}:LH`) ?? new Int32Array(0),
        hh: bands.get(`${String(r)}:HH`) ?? new Int32Array(0),
      },
      { u0: resolution.x0, u1: resolution.x1, v0: resolution.y0, v1: resolution.y1 },
    );
  }
  return current;
}

function decodeIrreversibleTileComponent(tile: Jpeg2000TileGeometry, componentIndex: number, componentBitDepth: number, data: Uint8Array<ArrayBuffer>): Float32Array {
  const component = tile.components[componentIndex];
  if (component === undefined) {
    throw new Jpeg2000ParseError(`the tile has no component ${String(componentIndex)}`);
  }
  const bands = new Map<string, Float32Array>();
  for (const resolution of component.resolutions) {
    for (const band of resolution.subbands) {
      const width = band.x1 - band.x0;
      const samples = new Float32Array(Math.max(width * (band.y1 - band.y0), 0));
      // Tier-1's own doubled scale and the dequantization step fold into one multiplier, so each coefficient is scaled exactly once.
      const scale = quantizationStep(band, componentBitDepth) / 2;
      decodeSubbandBlocks(band, component.coding.codeBlockStyle, data, (x, y, value) => {
        samples[y * width + x] = value * scale;
      });
      bands.set(`${String(resolution.index)}:${band.type}`, samples);
    }
  }
  let current = bands.get('0:LL') ?? new Float32Array(0);
  for (let r = 1; r < component.resolutions.length; r++) {
    const resolution = component.resolutions[r];
    if (resolution === undefined) {
      break;
    }
    current = inverseDwt97Level(
      {
        ll: current,
        hl: bands.get(`${String(r)}:HL`) ?? new Float32Array(0),
        lh: bands.get(`${String(r)}:LH`) ?? new Float32Array(0),
        hh: bands.get(`${String(r)}:HH`) ?? new Float32Array(0),
      },
      { u0: resolution.x0, u1: resolution.x1, v0: resolution.y0, v1: resolution.y1 },
    );
  }
  return current;
}

// G.2: the inverse reversible component transform, undoing the encoder's Y/Cb/Cr-like decorrelation of the first three components. Reversible in exact integer arithmetic, which is what makes a lossless colour round trip possible at all.
function inverseReversibleComponentTransform(planes: readonly Int32Array[]): void {
  const y = planes[0];
  const u = planes[1];
  const v = planes[2];
  if (y === undefined || u === undefined || v === undefined) {
    return;
  }
  for (let i = 0; i < y.length; i++) {
    const green = (y[i] ?? 0) - Math.floor(((u[i] ?? 0) + (v[i] ?? 0)) / 4);
    const red = (v[i] ?? 0) + green;
    const blue = (u[i] ?? 0) + green;
    y[i] = red;
    u[i] = green;
    v[i] = blue;
  }
}

// G.3 equations G-6 to G-8: the inverse irreversible component transform, the ordinary YCbCr-to-RGB matrix the 9-7 path pairs with.
const ICT_RED_FROM_CR = 1.402;
const ICT_GREEN_FROM_CB = -0.344136;
const ICT_GREEN_FROM_CR = -0.714136;
const ICT_BLUE_FROM_CB = 1.772;

function inverseIrreversibleComponentTransform(planes: readonly Float32Array[]): void {
  const y = planes[0];
  const cb = planes[1];
  const cr = planes[2];
  if (y === undefined || cb === undefined || cr === undefined) {
    return;
  }
  for (let i = 0; i < y.length; i++) {
    const luma = y[i] ?? 0;
    const blueDiff = cb[i] ?? 0;
    const redDiff = cr[i] ?? 0;
    y[i] = luma + ICT_RED_FROM_CR * redDiff;
    cb[i] = luma + ICT_GREEN_FROM_CB * blueDiff + ICT_GREEN_FROM_CR * redDiff;
    cr[i] = luma + ICT_BLUE_FROM_CB * blueDiff;
  }
}

export function decodeJpeg2000(data: Uint8Array<ArrayBuffer>, options: Jpeg2000DecodeOptions = {}): Jpeg2000Image {
  const onWarning = options.onWarning ?? ((): void => undefined);
  const container = parseJp2Container(data);
  const codestream = parseJpeg2000Codestream(container.codestream);
  const reason = undecodableReason(codestream);
  if (reason !== undefined) {
    throw new Jpeg2000UnsupportedError(reason);
  }
  if (codestream.truncated) {
    onWarning('the codestream ends without an EOC marker, so it is truncated; decoding whatever packets did arrive');
  }

  const siz = codestream.siz;
  const width = siz.xsiz - siz.xosiz;
  const height = siz.ysiz - siz.yosiz;
  const componentCount = siz.components.length;
  const first = siz.components[0];
  if (first === undefined) {
    throw new Jpeg2000ParseError('the codestream declares no components');
  }
  const planes: Int32Array[] = Array.from({ length: componentCount }, () => new Int32Array(width * height));

  const tileIndices = new Set(codestream.tileParts.map((part) => part.tileIndex));
  if (tileIndices.size === 0) {
    throw new Jpeg2000ParseError('the codestream carries no tile-part data');
  }
  for (const tileIndex of [...tileIndices].sort((a, b) => a - b)) {
    const tileX = tileIndex % codestream.numTilesWide;
    const tileY = Math.floor(tileIndex / codestream.numTilesWide);
    const firstPart = codestream.tileParts.find((part) => part.tileIndex === tileIndex && part.partIndex === 0);
    const tileHeader = firstPart?.header;
    const codingPerComponent = Array.from({ length: componentCount }, (_, c) => resolveCoding(codestream.main, tileHeader, c));
    const quantizationPerComponent = Array.from({ length: componentCount }, (_, c) => resolveQuantization(codestream.main, tileHeader, c));
    const defaults = tileDefaults(codestream.main, tileHeader);
    const geometry = buildTileGeometry(siz, tileX, tileY, codingPerComponent, quantizationPerComponent);
    const tileData = concatTilePartData(codestream, tileIndex);
    const sequence = buildPacketSequence(geometry, defaults.progressionOrder, defaults.layers);
    readTilePackets(tileData, 0, tileData.length, geometry, sequence, { useSop: defaults.useSop, useEph: defaults.useEph, onWarning });

    // The two transforms decode into different arithmetic domains -- exact integers and dequantized floats -- so each is reconstructed in its own and only rejoins the common path at the level shift below.
    const tilePlanes: (Int32Array | Float32Array)[] = [];
    if (defaults.transform === 'reversible-5-3') {
      const reversible = Array.from({ length: componentCount }, (_, c) => decodeReversibleTileComponent(geometry, c, tileData));
      if (defaults.multipleComponentTransform && componentCount >= 3) {
        inverseReversibleComponentTransform(reversible);
      }
      tilePlanes.push(...reversible);
    } else {
      const irreversible = Array.from({ length: componentCount }, (_, c) => decodeIrreversibleTileComponent(geometry, c, first.bitDepth, tileData));
      if (defaults.multipleComponentTransform && componentCount >= 3) {
        inverseIrreversibleComponentTransform(irreversible);
      }
      tilePlanes.push(...irreversible);
    }
    for (let c = 0; c < componentCount; c++) {
      const tileComponent = geometry.components[c];
      const source = tilePlanes[c];
      const destination = planes[c];
      if (tileComponent === undefined || source === undefined || destination === undefined) {
        continue;
      }
      const tileWidth = tileComponent.x1 - tileComponent.x0;
      for (let y = tileComponent.y0; y < tileComponent.y1; y++) {
        for (let x = tileComponent.x0; x < tileComponent.x1; x++) {
          // Rounding to nearest is a no-op for the reversible path (every value is already an integer) and the irreversible path's own final quantization back to sample precision.
          destination[(y - siz.yosiz) * width + (x - siz.xosiz)] = Math.round(source[(y - tileComponent.y0) * tileWidth + (x - tileComponent.x0)] ?? 0);
        }
      }
    }
  }

  // G.1.2: an unsigned component was level-shifted down by half its own range before the transform, so decoding puts that offset back and clamps to the range the component's declared depth can actually represent.
  const shift = first.signed ? 0 : 1 << (first.bitDepth - 1);
  const minimum = first.signed ? -(1 << (first.bitDepth - 1)) : 0;
  const maximum = first.signed ? (1 << (first.bitDepth - 1)) - 1 : (1 << first.bitDepth) - 1;
  for (const plane of planes) {
    for (let i = 0; i < plane.length; i++) {
      plane[i] = Math.min(Math.max((plane[i] ?? 0) + shift, minimum), maximum);
    }
  }

  const base = { width, height, bitDepth: first.bitDepth, signed: first.signed, components: planes, channelDefinitions: container.channelDefinitions };
  return container.colourSpace !== undefined ? { ...base, colourSpace: container.colourSpace } : base;
}
