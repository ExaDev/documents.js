import type { Jpeg2000CodingStyle, Jpeg2000ImageSize, Jpeg2000ProgressionOrder, Jpeg2000Quantization, Jpeg2000StepSize } from './jpeg2000-codestream';
import { Jpeg2000ParseError, Jpeg2000UnsupportedError } from './jpeg2000-errors';
import type { Jpeg2000SubbandType } from './jpeg2000-t1';
import { PacketBitReader, TagTree } from './jpeg2000-tagtree';

// The tile structure of ISO/IEC 15444-1 Annex B and the tier-2 packet decoding of B.9/B.10: working out which code-blocks exist and where their coded bytes are, without decoding a single coefficient. Splitting this from tier-1 keeps the two halves of EBCOT independently checkable -- this module's whole output is "code-block X's data is these byte ranges, carrying this many coding passes".

// B.3: the three subbands a resolution level above zero contributes, in the order the codestream lists them (and the order their quantization step sizes appear in QCD).
const HIGHER_RESOLUTION_BANDS: readonly Jpeg2000SubbandType[] = ['HL', 'LH', 'HH'];

// E.1.1 Table E.1: the log2 gain of each subband's synthesis, used to size the quantization step relative to the component's own bit depth.
const SUBBAND_GAIN_LOG2: Readonly<Record<Jpeg2000SubbandType, number>> = { LL: 0, HL: 1, LH: 1, HH: 2 };

// B.10.7: the code-block length signalling starts from a four-bit field width and grows only when the encoder says so.
const INITIAL_LBLOCK = 3;

export interface Jpeg2000CodeBlock {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  // Position within its precinct's own code-block grid, which is what the two tag trees are indexed by.
  readonly gridX: number;
  readonly gridY: number;
  included: boolean;
  lblock: number;
  zeroBitPlanes: number;
  passes: number;
  readonly chunks: { start: number; end: number }[];
}

export interface Jpeg2000Precinct {
  readonly inclusion: TagTree;
  readonly zeroBitPlaneTree: TagTree;
  readonly codeBlocks: Jpeg2000CodeBlock[];
}

export interface Jpeg2000Subband {
  readonly type: Jpeg2000SubbandType;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly stepSize: Jpeg2000StepSize;
  // Mb, the bit-plane count this subband's code-blocks are coded against (E.1 equation E-2).
  readonly maxBitPlanes: number;
  readonly precincts: readonly Jpeg2000Precinct[];
}

export interface Jpeg2000Resolution {
  readonly index: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly precinctsWide: number;
  readonly precinctsHigh: number;
  readonly subbands: readonly Jpeg2000Subband[];
}

export interface Jpeg2000TileComponent {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly coding: Jpeg2000CodingStyle;
  readonly quantization: Jpeg2000Quantization;
  readonly resolutions: readonly Jpeg2000Resolution[];
}

export interface Jpeg2000TileGeometry {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly components: readonly Jpeg2000TileComponent[];
}

interface Bounds {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function ceilDiv(value: number, divisor: number): number {
  return Math.ceil(value / divisor);
}

// B.3 equation B-4: a tile is the intersection of its slot in the tile grid with the image area.
function tileBounds(siz: Jpeg2000ImageSize, tileX: number, tileY: number): Bounds {
  return {
    x0: Math.max(siz.xtosiz + tileX * siz.xtsiz, siz.xosiz),
    y0: Math.max(siz.ytosiz + tileY * siz.ytsiz, siz.yosiz),
    x1: Math.min(siz.xtosiz + (tileX + 1) * siz.xtsiz, siz.xsiz),
    y1: Math.min(siz.ytosiz + (tileY + 1) * siz.ytsiz, siz.ysiz),
  };
}

// B.5 equation B-6: a component's own coordinate grid is the reference grid divided by that component's sub-sampling factors.
function componentBounds(tile: Bounds, dx: number, dy: number): Bounds {
  return { x0: ceilDiv(tile.x0, dx), y0: ceilDiv(tile.y0, dy), x1: ceilDiv(tile.x1, dx), y1: ceilDiv(tile.y1, dy) };
}

// B.5 equation B-14: resolution level r of a tile-component covers its own coordinates scaled down by the decomposition levels still to be applied.
function resolutionBounds(component: Bounds, levels: number, resolution: number): Bounds {
  const scale = 2 ** (levels - resolution);
  return { x0: ceilDiv(component.x0, scale), y0: ceilDiv(component.y0, scale), x1: ceilDiv(component.x1, scale), y1: ceilDiv(component.y1, scale) };
}

// B.6: how many precincts a resolution level is partitioned into. A level with no area holds none at all, which is not the same as holding one empty one.
function precinctGrid(bounds: Bounds, ppx: number, ppy: number): { wide: number; high: number } {
  return {
    wide: bounds.x1 > bounds.x0 ? Math.ceil(bounds.x1 / 2 ** ppx) - Math.floor(bounds.x0 / 2 ** ppx) : 0,
    high: bounds.y1 > bounds.y0 ? Math.ceil(bounds.y1 / 2 ** ppy) - Math.floor(bounds.y0 / 2 ** ppy) : 0,
  };
}

// Whether any resolution level of any component of this one tile is split into more than one precinct -- the exact condition buildPacketSequence refuses a position-driven progression order under. Computed from the geometry alone, with none of buildTileGeometry's own per-code-block allocation, so readJpeg2000Metadata can answer "is this decodable" for a large image without paying to set up a decode it is not going to run.
export function tileHasSubdividedPrecincts(siz: Jpeg2000ImageSize, tileX: number, tileY: number, codingPerComponent: readonly Jpeg2000CodingStyle[]): boolean {
  const tile = tileBounds(siz, tileX, tileY);
  for (let c = 0; c < siz.components.length; c++) {
    const size = siz.components[c];
    const coding = codingPerComponent[c];
    if (size === undefined || coding === undefined) {
      continue;
    }
    const component = componentBounds(tile, size.dx, size.dy);
    for (let r = 0; r <= coding.decompositionLevels; r++) {
      const precinctSize = coding.precinctSizes[r];
      if (precinctSize === undefined) {
        continue;
      }
      const grid = precinctGrid(resolutionBounds(component, coding.decompositionLevels, r), precinctSize.ppx, precinctSize.ppy);
      if (grid.wide * grid.high > 1) {
        return true;
      }
    }
  }
  return false;
}

// B.7 equation B-15: the coordinates of subband b, where (xob, yob) is (0,0) for LL, (1,0) for HL, (0,1) for LH and (1,1) for HH, and nb is the number of decomposition levels still applied to that band.
function bandCoordinate(componentCoordinate: number, levels: number, orientation: number): number {
  if (levels === 0) {
    return componentCoordinate;
  }
  const half = 2 ** (levels - 1);
  return Math.ceil((componentCoordinate - half * orientation) / (2 * half));
}

function quantizationIndex(resolution: number, bandIndex: number): number {
  return resolution === 0 ? 0 : 3 * (resolution - 1) + bandIndex + 1;
}

// E.1.1 equation E-5: with derived quantization only the LL band's step size is transmitted and every other band's exponent follows from its own decomposition level.
function stepSizeFor(quantization: Jpeg2000Quantization, resolution: number, bandIndex: number): Jpeg2000StepSize {
  if (quantization.style === 'derived') {
    const base = quantization.stepSizes[0];
    if (base === undefined) {
      throw new Jpeg2000ParseError('a QCD/QCC marker declares derived quantization but carries no step size');
    }
    return { exponent: Math.max(base.exponent - Math.max(resolution - 1, 0), 0), mantissa: base.mantissa };
  }
  const index = quantizationIndex(resolution, bandIndex);
  const step = quantization.stepSizes[index];
  if (step === undefined) {
    throw new Jpeg2000ParseError(`a QCD/QCC marker carries no step size for subband ${String(index)}, which its own decomposition level count requires`);
  }
  return step;
}

function buildPrecinct(
  band: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number },
  precinctX: number,
  precinctY: number,
  bandPpx: number,
  bandPpy: number,
  codeBlockWidthExp: number,
  codeBlockHeightExp: number,
): Jpeg2000Precinct {
  const precinctWidth = 2 ** bandPpx;
  const precinctHeight = 2 ** bandPpy;
  const originX = (Math.floor(band.x0 / precinctWidth) + precinctX) * precinctWidth;
  const originY = (Math.floor(band.y0 / precinctHeight) + precinctY) * precinctHeight;
  const px0 = Math.max(originX, band.x0);
  const py0 = Math.max(originY, band.y0);
  const px1 = Math.min(originX + precinctWidth, band.x1);
  const py1 = Math.min(originY + precinctHeight, band.y1);

  // B.7: a code-block never straddles a precinct boundary, so its own partition is the finer of the two.
  const cbWidth = 2 ** Math.min(codeBlockWidthExp, bandPpx);
  const cbHeight = 2 ** Math.min(codeBlockHeightExp, bandPpy);
  const gridX0 = Math.floor(px0 / cbWidth);
  const gridY0 = Math.floor(py0 / cbHeight);
  const gridX1 = px1 > px0 ? Math.ceil(px1 / cbWidth) : gridX0;
  const gridY1 = py1 > py0 ? Math.ceil(py1 / cbHeight) : gridY0;
  const gridWidth = gridX1 - gridX0;
  const gridHeight = gridY1 - gridY0;

  const codeBlocks: Jpeg2000CodeBlock[] = [];
  for (let gy = 0; gy < gridHeight; gy++) {
    for (let gx = 0; gx < gridWidth; gx++) {
      const cellX = (gridX0 + gx) * cbWidth;
      const cellY = (gridY0 + gy) * cbHeight;
      codeBlocks.push({
        x0: Math.max(cellX, px0),
        y0: Math.max(cellY, py0),
        x1: Math.min(cellX + cbWidth, px1),
        y1: Math.min(cellY + cbHeight, py1),
        gridX: gx,
        gridY: gy,
        included: false,
        lblock: INITIAL_LBLOCK,
        zeroBitPlanes: 0,
        passes: 0,
        chunks: [],
      });
    }
  }
  return { inclusion: new TagTree(gridWidth, gridHeight), zeroBitPlaneTree: new TagTree(gridWidth, gridHeight), codeBlocks };
}

export function buildTileGeometry(
  siz: Jpeg2000ImageSize,
  tileX: number,
  tileY: number,
  codingPerComponent: readonly Jpeg2000CodingStyle[],
  quantizationPerComponent: readonly Jpeg2000Quantization[],
): Jpeg2000TileGeometry {
  const tile = tileBounds(siz, tileX, tileY);
  const components: Jpeg2000TileComponent[] = [];
  for (let c = 0; c < siz.components.length; c++) {
    const componentSize = siz.components[c];
    const coding = codingPerComponent[c];
    const quantization = quantizationPerComponent[c];
    if (componentSize === undefined || coding === undefined || quantization === undefined) {
      throw new Jpeg2000ParseError(`no coding style or quantization is defined for component ${String(c)}`);
    }
    const bounds = componentBounds(tile, componentSize.dx, componentSize.dy);
    const levels = coding.decompositionLevels;
    const resolutions: Jpeg2000Resolution[] = [];
    for (let r = 0; r <= levels; r++) {
      const level = resolutionBounds(bounds, levels, r);
      const { x0: rx0, y0: ry0, x1: rx1, y1: ry1 } = level;
      const precinctSize = coding.precinctSizes[r];
      if (precinctSize === undefined) {
        throw new Jpeg2000ParseError(`the coding style declares ${String(levels)} decomposition levels but no precinct size for resolution ${String(r)}`);
      }
      const { ppx, ppy } = precinctSize;
      // B.6: for a resolution above zero the precinct partition maps onto the subbands at half its own size, so a precinct exponent of zero would have no subband-side meaning at all.
      if (r > 0 && (ppx === 0 || ppy === 0)) {
        throw new Jpeg2000ParseError(`resolution level ${String(r)} declares a precinct exponent of zero, which ISO/IEC 15444-1 B.6 permits only at resolution level 0`);
      }
      const { wide: precinctsWide, high: precinctsHigh } = precinctGrid(level, ppx, ppy);
      const bandPpx = r === 0 ? ppx : ppx - 1;
      const bandPpy = r === 0 ? ppy : ppy - 1;

      const bandTypes = r === 0 ? (['LL'] as const) : HIGHER_RESOLUTION_BANDS;
      const subbands: Jpeg2000Subband[] = [];
      for (let b = 0; b < bandTypes.length; b++) {
        const type = bandTypes[b] ?? 'LL';
        const bandLevels = r === 0 ? levels : levels - r + 1;
        const xob = type === 'HL' || type === 'HH' ? 1 : 0;
        const yob = type === 'LH' || type === 'HH' ? 1 : 0;
        const bx0 = bandCoordinate(bounds.x0, bandLevels, xob);
        const by0 = bandCoordinate(bounds.y0, bandLevels, yob);
        const bx1 = bandCoordinate(bounds.x1, bandLevels, xob);
        const by1 = bandCoordinate(bounds.y1, bandLevels, yob);
        const stepSize = stepSizeFor(quantization, r, b);
        const precincts: Jpeg2000Precinct[] = [];
        for (let py = 0; py < precinctsHigh; py++) {
          for (let px = 0; px < precinctsWide; px++) {
            precincts.push(buildPrecinct({ x0: bx0, y0: by0, x1: bx1, y1: by1 }, px, py, bandPpx, bandPpy, coding.codeBlockWidthExp, coding.codeBlockHeightExp));
          }
        }
        subbands.push({
          type,
          x0: bx0,
          y0: by0,
          x1: bx1,
          y1: by1,
          stepSize,
          // E.1 equation E-2: Mb is the subband's own exponent plus the guard bits, less one.
          maxBitPlanes: stepSize.exponent + quantization.guardBits - 1,
          precincts,
        });
      }
      resolutions.push({ index: r, x0: rx0, y0: ry0, x1: rx1, y1: ry1, precinctsWide, precinctsHigh, subbands });
    }
    components.push({ ...bounds, coding, quantization, resolutions });
  }
  return { ...tile, components };
}

export function subbandGainLog2(type: Jpeg2000SubbandType): number {
  return SUBBAND_GAIN_LOG2[type];
}

// B.10.6 Table B.4: the number of coding passes a code-block contributes to this layer, coded as a prefix code over the ranges 1, 2, 3-5, 6-36 and 37-164.
function readCodingPasses(reader: PacketBitReader): number {
  if (reader.readBit() === 0) {
    return 1;
  }
  if (reader.readBit() === 0) {
    return 2;
  }
  const twoBit = reader.readBits(2);
  if (twoBit < 3) {
    return 3 + twoBit;
  }
  const fiveBit = reader.readBits(5);
  if (fiveBit < 31) {
    return 6 + fiveBit;
  }
  return 37 + reader.readBits(7);
}

interface PacketPosition {
  readonly layer: number;
  readonly resolution: number;
  readonly component: number;
  readonly precinct: number;
}

// B.12: the five progression orders, as the nesting of the four loops each one names. RPCL, PCRL and CPRL iterate position on the reference grid rather than by precinct index, which only collapses to a plain loop when every tile-component-resolution holds exactly one precinct -- the check below refuses anything else rather than emitting packets in the wrong order.
export function buildPacketSequence(tile: Jpeg2000TileGeometry, order: Jpeg2000ProgressionOrder, layers: number): PacketPosition[] {
  const maxResolutions = Math.max(...tile.components.map((component) => component.resolutions.length));
  const precinctCount = (component: number, resolution: number): number => {
    const resolutions = tile.components[component]?.resolutions;
    const level = resolutions?.[resolution];
    return level === undefined ? 0 : level.precinctsWide * level.precinctsHigh;
  };
  const packets: PacketPosition[] = [];
  const push = (layer: number, resolution: number, component: number, precinct: number): void => {
    packets.push({ layer, resolution, component, precinct });
  };

  if (order === 'LRCP') {
    for (let l = 0; l < layers; l++) {
      for (let r = 0; r < maxResolutions; r++) {
        for (let c = 0; c < tile.components.length; c++) {
          for (let p = 0; p < precinctCount(c, r); p++) {
            push(l, r, c, p);
          }
        }
      }
    }
    return packets;
  }
  if (order === 'RLCP') {
    for (let r = 0; r < maxResolutions; r++) {
      for (let l = 0; l < layers; l++) {
        for (let c = 0; c < tile.components.length; c++) {
          for (let p = 0; p < precinctCount(c, r); p++) {
            push(l, r, c, p);
          }
        }
      }
    }
    return packets;
  }

  for (let c = 0; c < tile.components.length; c++) {
    for (let r = 0; r < maxResolutions; r++) {
      if (precinctCount(c, r) > 1) {
        throw new Jpeg2000UnsupportedError(`progression order ${order} is only decoded here when every resolution level holds a single precinct, and this codestream subdivides at least one of them`);
      }
    }
  }
  if (order === 'RPCL') {
    for (let r = 0; r < maxResolutions; r++) {
      for (let c = 0; c < tile.components.length; c++) {
        for (let l = 0; l < layers; l++) {
          if (precinctCount(c, r) > 0) {
            push(l, r, c, 0);
          }
        }
      }
    }
    return packets;
  }
  if (order === 'PCRL') {
    for (let c = 0; c < tile.components.length; c++) {
      for (let r = 0; r < maxResolutions; r++) {
        for (let l = 0; l < layers; l++) {
          if (precinctCount(c, r) > 0) {
            push(l, r, c, 0);
          }
        }
      }
    }
    return packets;
  }
  for (let c = 0; c < tile.components.length; c++) {
    for (let r = 0; r < maxResolutions; r++) {
      for (let l = 0; l < layers; l++) {
        if (precinctCount(c, r) > 0) {
          push(l, r, c, 0);
        }
      }
    }
  }
  return packets;
}

const MARKER_SOP_HIGH = 0xff;
const MARKER_SOP_LOW = 0x91;
const MARKER_EPH_LOW = 0x92;
const SOP_SEGMENT_BYTES = 6;
const EPH_MARKER_BYTES = 2;

export interface PacketReadOptions {
  readonly useSop: boolean;
  readonly useEph: boolean;
  readonly onWarning: (message: string) => void;
}

// B.9/B.10: reads every packet of one tile in the order `sequence` gives, filling in each code-block's inclusion state, zero bit-plane count, coding-pass count and the byte ranges its coded data occupies. Returns the offset one past the last byte consumed.
export function readTilePackets(
  data: Uint8Array<ArrayBuffer>,
  start: number,
  end: number,
  tile: Jpeg2000TileGeometry,
  sequence: readonly PacketPosition[],
  options: PacketReadOptions,
): number {
  let position = start;
  for (let packetIndex = 0; packetIndex < sequence.length; packetIndex++) {
    const packet = sequence[packetIndex];
    if (packet === undefined) {
      break;
    }
    if (position >= end) {
      options.onWarning(`the tile's coded data ended after ${String(packetIndex)} of ${String(sequence.length)} packets; the rest of the image is reconstructed from what did arrive`);
      return position;
    }
    if (options.useSop && position + SOP_SEGMENT_BYTES <= end && data[position] === MARKER_SOP_HIGH && data[position + 1] === MARKER_SOP_LOW) {
      position += SOP_SEGMENT_BYTES;
    }
    const component = tile.components[packet.component];
    const resolution = component?.resolutions[packet.resolution];
    if (component === undefined || resolution === undefined) {
      throw new Jpeg2000ParseError('the progression sequence names a resolution level the tile does not have');
    }

    const reader = new PacketBitReader(data, position, end);
    const included: Jpeg2000CodeBlock[] = [];
    const lengths: number[] = [];
    if (reader.readBit() === 1) {
      for (const band of resolution.subbands) {
        const precinct = band.precincts[packet.precinct];
        if (precinct === undefined) {
          continue;
        }
        for (const block of precinct.codeBlocks) {
          const isIncluded = block.included ? reader.readBit() === 1 : precinct.inclusion.decode(reader, block.gridX, block.gridY, packet.layer + 1);
          if (!isIncluded) {
            continue;
          }
          if (!block.included) {
            block.included = true;
            let threshold = 1;
            while (!precinct.zeroBitPlaneTree.decode(reader, block.gridX, block.gridY, threshold)) {
              threshold++;
            }
            block.zeroBitPlanes = threshold - 1;
          }
          const passes = readCodingPasses(reader);
          while (reader.readBit() === 1) {
            block.lblock++;
          }
          // B.10.7: the length field is Lblock bits wide plus however many bits the pass count itself needs, since a segment carrying more passes can be proportionally longer.
          const lengthBits = block.lblock + Math.floor(Math.log2(passes));
          const length = reader.readBits(lengthBits);
          block.passes += passes;
          included.push(block);
          lengths.push(length);
        }
      }
    }
    reader.alignToByte();
    position = reader.offset;
    if (options.useEph && position + EPH_MARKER_BYTES <= end && data[position] === MARKER_SOP_HIGH && data[position + 1] === MARKER_EPH_LOW) {
      position += EPH_MARKER_BYTES;
    }

    for (let i = 0; i < included.length; i++) {
      const block = included[i];
      const length = lengths[i] ?? 0;
      if (block === undefined) {
        continue;
      }
      const chunkEnd = Math.min(position + length, end);
      if (chunkEnd < position + length) {
        options.onWarning('a code-block declares more coded bytes than the tile carries; decoding it from the bytes that did arrive');
      }
      block.chunks.push({ start: position, end: chunkEnd });
      position += length;
      if (position > end) {
        return end;
      }
    }
  }
  return position;
}
