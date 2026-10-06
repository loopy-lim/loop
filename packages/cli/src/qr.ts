/**
 * Minimal QR encoder (decision 2026-xx-qr-pairing D-C, dependency rule).
 *
 * Pure function: payload string → module matrix. No I/O, no renderer — the
 * CLI draws UTF-8 half-blocks (renderAsciiQr), the desktop app draws SVG
 * from an identical encoder. Byte mode only, ECC level L, single-block
 * versions 1/2/3/5 — a pairing payload (MagicDNS host + port) always fits
 * and stays deterministic. Longer payloads are a hard error, never a
 * silent fallback.
 *
 * The desktop app carries a byte-identical copy of the encoder (surface
 * write scopes forbid a shared package); both copies are pinned to the same
 * committed golden matrix in tests.
 */

export type QrSpec = {
  version: number;
  size: number;
  dataCodewords: number;
  eccCodewords: number;
  /** Zero bits appended after the final codeword (ISO 18004 remainder). */
  remainderBits: number;
  /** Alignment pattern center coordinates (empty for version 1). */
  alignment: number[];
};

/** Single-block versions at ECC level L (one Reed-Solomon block each). */
const VERSIONS: QrSpec[] = [
  { version: 1, size: 21, dataCodewords: 19, eccCodewords: 7, remainderBits: 0, alignment: [] },
  {
    version: 2,
    size: 25,
    dataCodewords: 34,
    eccCodewords: 10,
    remainderBits: 7,
    alignment: [6, 18],
  },
  {
    version: 3,
    size: 29,
    dataCodewords: 55,
    eccCodewords: 15,
    remainderBits: 7,
    alignment: [6, 22],
  },
  {
    version: 5,
    size: 37,
    dataCodewords: 108,
    eccCodewords: 26,
    remainderBits: 7,
    alignment: [6, 30],
  },
];

/** Largest payload the supported versions can carry, in bytes. */
export const QR_MAX_BYTES = at(VERSIONS, VERSIONS.length - 1).dataCodewords - 2;

/** 루프 불변식이 보장하는 배열 인덱스를 명시적으로 읽는다. 범위를 벗어나면
 * QR 인코더의 불변식이 깨진 것이므로 undefined 를 연산에 흘려보내지 않고
 * 즉시 실패한다. */
function at<T>(items: ArrayLike<T>, index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`qr encoder invariant violated: index ${index} outside length ${items.length}`);
  }
  return value;
}

export class QrCapacityError extends Error {
  override readonly name = "QrCapacityError";
  constructor(maxBytes: number) {
    super(
      `QR payload exceeds the ${maxBytes}-byte capacity of supported versions (1/2/3/5, level L)`,
    );
  }
}

// ---------------------------------------------------------------------------
// GF(256) arithmetic, primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11D).
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(510);
const GF_LOG = new Uint8Array(256);
(function initializeField(): void {
  let value = 1;
  for (let exponent = 0; exponent < 255; exponent += 1) {
    GF_EXP[exponent] = value;
    GF_LOG[value] = exponent;
    value <<= 1;
    if (value >= 0x100) value ^= 0x11d;
  }
  for (let exponent = 255; exponent < 510; exponent += 1) {
    GF_EXP[exponent] = at(GF_EXP, exponent - 255);
  }
})();

function gfMultiply(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return at(GF_EXP, at(GF_LOG, a) + at(GF_LOG, b));
}

/** Generator polynomial ∏(x − α^i) for i in 0..n−1; index 0 = highest degree. */
function rsGenerator(eccLength: number): number[] {
  let poly: number[] = [1];
  for (let i = 0; i < eccLength; i += 1) {
    const next: number[] = Array.from({ length: poly.length + 1 }, () => 0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] = at(next, j) ^ at(poly, j);
      next[j + 1] = at(next, j + 1) ^ gfMultiply(at(poly, j), at(GF_EXP, i));
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon ECC codewords for one block of data codewords. */
function rsRemainder(data: number[], eccLength: number): number[] {
  const generator = rsGenerator(eccLength);
  const working: number[] = data.slice().concat(Array.from({ length: eccLength }, () => 0));
  for (let i = 0; i < data.length; i += 1) {
    const factor = at(working, i);
    if (factor === 0) continue;
    for (let j = 0; j < generator.length; j += 1) {
      working[i + j] = at(working, i + j) ^ gfMultiply(at(generator, j), factor);
    }
  }
  return working.slice(data.length);
}

// ---------------------------------------------------------------------------
// Format information: 5 data bits (ECL<<3 | mask) + BCH(15,5), XOR 0x5412.
// ---------------------------------------------------------------------------

const FORMAT_ECC_LEVEL_BITS = 0b01; // level L
const FORMAT_BCH_GENERATOR = 0x537;
const FORMAT_FINAL_XOR = 0x5412;

/** The 15 format bits (LSB-first) for the given mask id. */
export function formatBits(maskId: number): boolean[] {
  const data = (FORMAT_ECC_LEVEL_BITS << 3) | maskId;
  let remainder = data << 10;
  for (let degree = 14; degree >= 10; degree -= 1) {
    if (((remainder >> degree) & 1) !== 0) remainder ^= FORMAT_BCH_GENERATOR << (degree - 10);
  }
  const value = ((data << 10) | remainder) ^ FORMAT_FINAL_XOR;
  const bits: boolean[] = [];
  for (let i = 0; i < 15; i += 1) bits.push(((value >> i) & 1) !== 0);
  return bits;
}

// ---------------------------------------------------------------------------
// Module placement.
// ---------------------------------------------------------------------------

/** Mask formulas (ISO 18004 §8.8.2); coordinates are (column x, row y). */
export function maskBit(maskId: number, x: number, y: number): boolean {
  switch (maskId) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x * y) % 3) + ((x + y) % 2)) % 2 === 0;
  }
}

/** True when (centerRow, centerCol) would collide with a finder pattern. */
function alignmentOverlapsFinder(size: number, row: number, col: number): boolean {
  return (
    (row === 6 && col === 6) || (row === 6 && col === size - 7) || (row === size - 7 && col === 6)
  );
}

function drawFinder(
  mark: (row: number, col: number, dark: boolean) => void,
  top: number,
  left: number,
): void {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const distance = Math.max(Math.abs(dy - 3), Math.abs(dx - 3));
      mark(top + dy, left + dx, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(
  mark: (row: number, col: number, dark: boolean) => void,
  centerRow: number,
  centerCol: number,
): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dy), Math.abs(dx));
      mark(centerRow + dy, centerCol + dx, distance !== 1);
    }
  }
}

export type FunctionPatterns = {
  /** Inked function modules (finder, timing, alignment, dark module). */
  dark: boolean[][];
  /** True for EVERY function cell regardless of darkness — data never lands here. */
  reserved: boolean[][];
};

/** Draw finders + separators, timing, alignment, the reserved format areas
 * (both copies, inked by drawFormat later), and the fixed dark module. */
export function functionPatterns(spec: QrSpec): FunctionPatterns {
  const dark: boolean[][] = Array.from({ length: spec.size }, () =>
    Array.from({ length: spec.size }, () => false),
  );
  const reserved: boolean[][] = Array.from({ length: spec.size }, () =>
    Array.from({ length: spec.size }, () => false),
  );
  const mark = (row: number, col: number, isDark: boolean): void => {
    if (row < 0 || row >= spec.size || col < 0 || col >= spec.size) return;
    const darkRow = at(dark, row);
    const reservedRow = at(reserved, row);
    darkRow[col] = isDark;
    reservedRow[col] = true;
  };
  drawFinder(mark, 0, 0);
  drawFinder(mark, 0, spec.size - 7);
  drawFinder(mark, spec.size - 7, 0);
  for (let i = 8; i <= spec.size - 9; i += 1) {
    mark(6, i, i % 2 === 0);
    mark(i, 6, i % 2 === 0);
  }
  for (const centerRow of spec.alignment) {
    for (const centerCol of spec.alignment) {
      if (!alignmentOverlapsFinder(spec.size, centerRow, centerCol))
        drawAlignment(mark, centerRow, centerCol);
    }
  }
  for (let i = 0; i <= 5; i += 1) mark(i, 8, false);
  mark(7, 8, false);
  mark(8, 8, false);
  mark(8, 7, false);
  for (let i = 9; i <= 14; i += 1) mark(8, 14 - i, false);
  for (let i = 0; i <= 7; i += 1) mark(spec.size - 1 - i, 8, false);
  for (let i = 8; i <= 14; i += 1) mark(8, spec.size - 15 + i, false);
  mark(spec.size - 8, 8, true);
  return { dark, reserved };
}

function drawFormat(modules: boolean[][], spec: QrSpec, maskId: number): void {
  const bits = formatBits(maskId);
  const set = (row: number, col: number, isDark: boolean): void => {
    at(modules, row)[col] = isDark;
  };
  // Copy 1: around the top-left finder.
  for (let i = 0; i <= 5; i += 1) set(i, 8, at(bits, i));
  set(7, 8, at(bits, 6));
  set(8, 8, at(bits, 7));
  set(8, 7, at(bits, 8));
  for (let i = 9; i <= 14; i += 1) set(8, 14 - i, at(bits, i));
  // Copy 2: split between the bottom-left and top-right finders.
  for (let i = 0; i <= 7; i += 1) set(spec.size - 1 - i, 8, at(bits, i));
  for (let i = 8; i <= 14; i += 1) set(8, spec.size - 15 + i, at(bits, i));
}

// ---------------------------------------------------------------------------
// Encoding.
// ---------------------------------------------------------------------------

function encodeSegment(text: string, spec: QrSpec): boolean[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  if (bytes.length > spec.dataCodewords - 2) throw new QrCapacityError(QR_MAX_BYTES);
  const bits: boolean[] = [];
  const push = (value: number, length: number): void => {
    for (let shift = length - 1; shift >= 0; shift -= 1) bits.push(((value >> shift) & 1) !== 0);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, 8); // character count (versions 1..9)
  for (const byte of bytes) push(byte, 8);
  const capacityBits = spec.dataCodewords * 8;
  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(false);
  const dataCodewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let shift = 0; shift < 8; shift += 1) byte = (byte << 1) | (bits[i + shift] ? 1 : 0);
    dataCodewords.push(byte);
  }
  for (let padByte = 0xec; dataCodewords.length < spec.dataCodewords; padByte ^= 0xec ^ 0x11) {
    dataCodewords.push(padByte);
  }
  // The final codeword stream is a fresh buffer: the segment bits above are
  // consumed by the data codewords and are not part of the placed stream.
  const finalBits: boolean[] = [];
  const pushFinal = (value: number, length: number): void => {
    for (let shift = length - 1; shift >= 0; shift -= 1)
      finalBits.push(((value >> shift) & 1) !== 0);
  };
  for (const codeword of dataCodewords.concat(rsRemainder(dataCodewords, spec.eccCodewords))) {
    pushFinal(codeword, 8);
  }
  pushFinal(0, spec.remainderBits);
  return finalBits;
}

function placeData(
  finalBits: boolean[],
  spec: QrSpec,
  base: boolean[][],
  reserved: boolean[][],
  maskId: number,
): boolean[][] {
  const modules: boolean[][] = base.map((row) => row.slice());
  let bitIndex = 0;
  for (let right = spec.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < spec.size; vertical += 1) {
      for (let columnOffset = 0; columnOffset < 2; columnOffset += 1) {
        const col = right - columnOffset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? spec.size - 1 - vertical : vertical;
        if (at(reserved, row)[col]) continue;
        const isDark =
          bitIndex < finalBits.length ? finalBits[bitIndex] !== maskBit(maskId, col, row) : false;
        at(modules, row)[col] = isDark;
        bitIndex += 1;
      }
    }
  }
  return modules;
}

function chooseMask(
  finalBits: boolean[],
  spec: QrSpec,
  base: boolean[][],
  reserved: boolean[][],
): number {
  let bestMaskId = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;
  for (let maskId = 0; maskId < 8; maskId += 1) {
    const penalty = scorePenalty(placeData(finalBits, spec, base, reserved, maskId));
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMaskId = maskId;
    }
  }
  return bestMaskId;
}

/** N3: no dark module within the four light modules before the pattern. */
function lightBefore(get: (i: number) => boolean, offset: number): boolean {
  for (let i = 1; i <= 4; i += 1) if (get(offset - i)) return false;
  return true;
}

/** Advisory mask-quality score (ISO 18004 §8.8.3); deterministic. */
function scorePenalty(modules: boolean[][]): number {
  const size = modules.length;
  let penalty = 0;
  const scanRuns = (get: (i: number) => boolean): void => {
    let runValue = get(0);
    let runLength = 1;
    for (let i = 1; i < size; i += 1) {
      if (get(i) === runValue) {
        runLength += 1;
        if (runLength === 5) penalty += 3;
        else if (runLength > 5) penalty += 1;
      } else {
        runValue = get(i);
        runLength = 1;
      }
    }
  };
  for (const row of modules) scanRuns((i) => at(row, i));
  for (let col = 0; col < size; col += 1) scanRuns((i) => at(at(modules, i), col));
  // N2: 2×2 blocks of one color.
  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const isDark = at(at(modules, row), col);
      if (
        at(at(modules, row), col + 1) === isDark &&
        at(at(modules, row + 1), col) === isDark &&
        at(at(modules, row + 1), col + 1) === isDark
      ) {
        penalty += 3;
      }
    }
  }
  // N3: 1011101 with four light modules on at least one side (either order).
  const finderPattern = [true, false, true, true, true, false, true];
  const finderAt = (get: (i: number) => boolean, offset: number): boolean => {
    for (let i = 0; i < 7; i += 1) {
      if (get(offset + i) !== at(finderPattern, i)) return false;
    }
    return true;
  };
  const scanFinders = (get: (i: number) => boolean): void => {
    for (let offset = 4; offset + 7 < size; offset += 1) {
      if (!finderAt(get, offset)) continue;
      if (lightBefore(get, offset) || get(offset + 7) === false) penalty += 40;
    }
  };
  for (const row of modules) scanFinders((i) => at(row, i));
  for (let col = 0; col < size; col += 1) scanFinders((i) => at(at(modules, i), col));
  // N4: dark/light proportion.
  let darkCount = 0;
  for (const row of modules) for (const isDark of row) if (isDark) darkCount += 1;
  const total = size * size;
  penalty += Math.ceil(Math.abs(darkCount * 20 - total * 10) / (total * 10)) * 10;
  return penalty;
}

export type QrEncoding = {
  matrix: boolean[][];
  maskId: number;
  /** Encoded codeword stream (data + ECC + remainder bits), MSB-first. */
  finalBits: boolean[];
  spec: QrSpec;
};

export function encodeQrMatrix(text: string): QrEncoding {
  const bytes = Array.from(new TextEncoder().encode(text));
  const spec = VERSIONS.find((candidate) => bytes.length <= candidate.dataCodewords - 2);
  if (spec === undefined) throw new QrCapacityError(QR_MAX_BYTES);
  const finalBits = encodeSegment(text, spec);
  const { dark, reserved } = functionPatterns(spec);
  const maskId = chooseMask(finalBits, spec, dark, reserved);
  const matrix = placeData(finalBits, spec, dark, reserved, maskId);
  drawFormat(matrix, spec, maskId);
  return { matrix, maskId, finalBits, spec };
}

/** The QR module matrix for `text`, ready for any renderer. */
export function encodeQr(text: string): boolean[][] {
  return encodeQrMatrix(text).matrix;
}

/** UTF-8 half-block ASCII rendering (two matrix rows per text line). */
export function renderAsciiQr(matrix: boolean[][], quietZone = 2): string {
  const size = matrix.length;
  const padded = size + quietZone * 2;
  const moduleAt = (row: number, col: number): boolean => {
    if (
      row < quietZone ||
      col < quietZone ||
      row >= padded - quietZone ||
      col >= padded - quietZone
    )
      return false;
    return at(at(matrix, row - quietZone), col - quietZone);
  };
  const lines: string[] = [];
  for (let row = 0; row < padded; row += 2) {
    let line = "";
    for (let col = 0; col < padded; col += 1) {
      const top = moduleAt(row, col);
      const bottom = moduleAt(row + 1, col);
      if (top && bottom) line += "█";
      else if (top) line += "▀";
      else if (bottom) line += "▄";
      else line += " ";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
