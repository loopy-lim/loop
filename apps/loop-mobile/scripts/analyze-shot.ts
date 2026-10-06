/**
 * Screenshot pixel analysis for the attention demo (dev-time calibration,
 * task simulator-attention-demo). Decodes a PNG (8-bit RGB/RGBA, no
 * interlace — iOS simulator screenshots qualify) and reports per-row counts
 * of exact-match design-token colors so UI element positions can be
 * measured without eyeballs.
 *
 * Usage: bun apps/loop-mobile/scripts/analyze-shot.ts <shot.png>
 */
import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return (c ^ 0xffffffff) >>> 0;
}

function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Uint8Array } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      bitDepth = body[8];
      colorType = body[9];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) throw new Error(`unsupported PNG: depth=${bitDepth} color=${colorType}`);
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body));
    } else if (type === "IEND") {
      break;
    }
    at += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = row[x];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[x] = v;
    }
  }
  return { width, height, channels, data: out };
}

const path = process.argv[2];
const img = decodePng(readFileSync(path));

// Token colors (sRGB, opaque background compositing): warn #D29922,
// surface #161C26, bg #0D1117, userBubble ~#1D2530-family (unused).
const targets: Array<[string, [number, number, number]]> = [
  ["warn", [0xd2, 0x99, 0x22]],
  ["surface", [0x16, 0x1c, 0x26]],
  ["bg", [0x0d, 0x11, 0x17]],
];

// Per-row counts, bucketed every 30 pixel rows to keep the report compact.
const BUCKET = 30;
const counts = new Map<string, number[]>();
for (const [name] of targets) counts.set(name, new Array(Math.ceil(img.height / BUCKET)).fill(0));
for (let y = 0; y < img.height; y++) {
  const bucket = Math.floor(y / BUCKET);
  for (let x = 0; x < img.width; x += 2) {
    const i = (y * img.width + x) * img.channels;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    for (const [name, [tr, tg, tb]] of targets) {
      if (Math.abs(r - tr) <= 3 && Math.abs(g - tg) <= 3 && Math.abs(b - tb) <= 3) {
        counts.get(name)![bucket] += 1;
      }
    }
  }
}

if (process.argv[3] === "hist") {
  const hist = new Map<string, number>();
  for (let y = 0; y < img.height; y += 4) {
    for (let x = 0; x < img.width; x += 4) {
      const i = (y * img.width + x) * img.channels;
      const key = `${img.data[i] >> 4},${img.data[i + 1] >> 4},${img.data[i + 2] >> 4}`;
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  for (const [k, n] of [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const [r, g, b] = k.split(",").map((v) => parseInt(v, 10) * 16 + 8);
    console.log(`rgb(${r},${g},${b})  ${((100 * n) / total).toFixed(1)}%`);
  }
  process.exit(0);
}

console.log(`# ${path} ${img.width}x${img.height}`);
console.log("rows(y..y+30) warn surface bg   (sampled every 2nd px; /150 ≈ logical-pt rows @3x)");
for (let bucket = 0; bucket < counts.get("warn")!.length; bucket++) {
  const w = counts.get("warn")![bucket];
  const s = counts.get("surface")![bucket];
  const b = counts.get("bg")![bucket];
  if (w > 5 || s > 5 || b > 5) {
    const y0 = bucket * BUCKET;
    console.log(
      `${String(y0).padStart(5)}..${String(y0 + BUCKET - 1).padStart(5)}  ${String(w).padStart(6)} ${String(s).padStart(6)} ${String(b).padStart(6)}  fy=${(y0 / img.height).toFixed(3)}`,
    );
  }
}
