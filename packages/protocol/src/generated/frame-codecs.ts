// ── rustra generated ────────────────────────────────────────
// File:   frame-codecs.ts
// Source: schema.json (single source of truth for this file)
// Regen:  rustra codegen --config rustra.json
// Stage:  schema → ts codec renderer
// DO NOT EDIT — changes will be overwritten and fail codegen --check.
// ────────────────────────────────────────────────────────────

// ── postcard wire format helpers ─────────────────────────────

const _dvScratchBuf = new ArrayBuffer(8);
const _dvScratch = new DataView(_dvScratchBuf);
const _dvScratchU8 = new Uint8Array(_dvScratchBuf);

function _pcEncodeVarint(n: number): Uint8Array {
  n = Math.floor(n);
  if (n < 0) throw new Error('varint must be non-negative: ' + n);
  if (n === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  while (n > 0) {
    let b = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) b += 128;
    bytes.push(b);
  }
  return new Uint8Array(bytes);
}

function _pcDecodeVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let multiplier = 1;
  let bytesRead = 0;
  while (true) {
    const b = buf[offset + bytesRead];
    if (b === undefined) throw new Error('varint out of bounds');
    value += (b & 0x7f) * multiplier;
    bytesRead++;
    if ((b & 0x80) === 0) break;
    multiplier *= 128;
    if (bytesRead > 10) throw new Error('varint too long');
  }
  return { value, bytesRead };
}

function _pcEncodeZigzag(n: number): number { return n >= 0 ? n * 2 : -n * 2 - 1; }
function _pcDecodeZigzag(n: number): number {
  const negative = n % 2 === 1;
  const magnitude = Math.floor(n / 2);
  return negative ? -magnitude - 1 : magnitude;
}
function _pcEncodeZigzagVarint(n: number): Uint8Array { return _pcEncodeVarint(_pcEncodeZigzag(n)); }
function _pcDecodeZigzagVarint(buf: Uint8Array, offset: number): { value: number; bytesRead: number } {
  const { value, bytesRead } = _pcDecodeVarint(buf, offset);
  return { value: _pcDecodeZigzag(value), bytesRead };
}

const _pcI64Min = -(2n ** 63n);
const _pcI64Max = 2n ** 63n - 1n;

function _pcEncodeVarint64(v: number | bigint): Uint8Array {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return _pcEncodeVarint(v);
  let value = BigInt(v);
  if (value < 0n) throw new Error('varint must be non-negative: ' + value.toString());
  if (value > 0xffffffffffffffffn) throw new Error('varint exceeds u64 range: ' + value.toString());
  const bytes: number[] = [];
  do {
    let next = Number(value & 0x7fn);
    value >>= 7n;
    if (value !== 0n) next |= 0x80;
    bytes.push(next);
  } while (value !== 0n);
  return new Uint8Array(bytes);
}

function _pcDecodeVarint64(buf: Uint8Array, offset: number): { value: number | bigint; bytesRead: number } {
  let num = 0;
  let multiplier = 1;
  let big = 0n;
  let bytesRead = 0;
  while (true) {
    const b = buf[offset + bytesRead];
    if (b === undefined) throw new Error('varint out of bounds');
    bytesRead++;
    if (bytesRead <= 7) {
      num += (b & 0x7f) * multiplier;
      multiplier *= 128;
      if ((b & 0x80) === 0) return { value: num, bytesRead };
    } else {
      if (bytesRead === 8) big = BigInt(num);
      big |= BigInt(b & 0x7f) << BigInt(7 * (bytesRead - 1));
      if ((b & 0x80) === 0) {
        if (bytesRead === 10 && (b & 0x7f) > 0x01) throw new Error('varint exceeds 64 bits');
        const asNumber = Number(big);
        return { value: Number.isSafeInteger(asNumber) ? asNumber : big, bytesRead };
      }
    }
    if (bytesRead >= 10) throw new Error('varint too long');
  }
}

function _pcEncodeZigzag64(v: number | bigint): Uint8Array {
  const n = BigInt(v);
  if (n < _pcI64Min || n > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + n.toString());
  return _pcEncodeVarint64((n << 1n) ^ (n >> 63n));
}
function _pcDecodeZigzag64(v: number | bigint): number | bigint {
  const decoded = (BigInt(v) >> 1n) ^ -(BigInt(v) & 1n);
  const asNumber = Number(decoded);
  return Number.isSafeInteger(asNumber) ? asNumber : decoded;
}

function _pcConcatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  let totalLen = 0;
  for (const a of arrays) totalLen += a.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) { result.set(a, offset); offset += a.length; }
  return result;
}

function _utf8Encode(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const low = s.charCodeAt(++i);
      const cp = 0x10000 + ((c - 0xd800) << 10) + (low - 0xdc00);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

function _utf8Decode(bytes: Uint8Array, start: number, end: number): string {
  // end 가 버퍼를 넘으면 즉시 실패 — 잘린 프레임에서 while (i < end) 가
  // undefined 바이트를 수없이 돌아 런타임이 멈추는 것을 막는다.
  if (end > bytes.length) throw new Error('string out of bounds');
  let s = ''; let i = start;
  while (i < end) {
    const b = bytes[i];
    if (b < 0x80) { s += String.fromCharCode(b); i += 1; }
    else if ((b & 0xe0) === 0xc0) { s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
    else if ((b & 0xf0) === 0xe0) { s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3; }
    else if ((b & 0xf8) === 0xf0) { const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); const adj = cp - 0x10000; s += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff)); i += 4; }
    else i += 1;
  }
  return s;
}

function _pcEncodeString(s: string): Uint8Array { const bytes = _utf8Encode(s); return _pcConcatUint8Arrays([_pcEncodeVarint(bytes.length), bytes]); }
function _pcDecodeString(buf: Uint8Array, offset: number): { value: string; bytesRead: number } {
  const len = _pcDecodeVarint(buf, offset); const start = offset + len.bytesRead; const end = start + len.value;
  return { value: _utf8Decode(buf, start, end), bytesRead: len.bytesRead + len.value };
}

function _pcEncodeF64(n: number): Uint8Array { const buf = new ArrayBuffer(8); new DataView(buf).setFloat64(0, n, true); return new Uint8Array(buf); }
function _pcDecodeF64(buf: Uint8Array, offset: number): { value: number; bytesRead: number } { return { value: new DataView(buf.buffer, buf.byteOffset + offset, 8).getFloat64(0, true), bytesRead: 8 }; }
function _pcEncodeF32(n: number): Uint8Array { const buf = new ArrayBuffer(4); new DataView(buf).setFloat32(0, n, true); return new Uint8Array(buf); }
function _pcDecodeF32(buf: Uint8Array, offset: number): { value: number; bytesRead: number } { return { value: new DataView(buf.buffer, buf.byteOffset + offset, 4).getFloat32(0, true), bytesRead: 4 }; }

import { createComplexCodec, createSchemaPostcardCodec } from '@rustra/types';
import type { FrameCodec, RustraError, ComplexSchema } from '@rustra/types';
import type { ActiveWorkerOutput, AddTaskInput, Array_of_EventOutput, AttentionKind, CheckResultInput, ClaimRunnableTasksInput, CleanupRunInput, CleanupRunOutput, CompletionCheckInput, ComputeClass, CreateRunInput, DecisionInput, EventOutput, OperationOutput, RequestAttentionInput, ResolveAttentionInput, RunInput, RunState, SkippedArtifactOutput, SnapshotOutput, SubmitPlanInput, SubmitPlanOutput, SubscribeEventsInput, TaskIdsOutput, TaskKind, TaskSnapshotOutput, TaskSpecInput, TaskState, UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput } from './types.js';

export const addTaskCodec: FrameCodec<AddTaskInput, OperationOutput> = {
  commandId: 4,
  execution: "sync",

  encode(args: AddTaskInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(AddTaskInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 4, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.task.id));
    parts.push(_pcEncodeString(args.task.title));
    {
      const _variants = ["research","decision","implementation","verification","integration"];
      const _idx = _variants.indexOf(args.task.kind);
      if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.task.kind);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _arr = args.task.dependencies;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]));
      }
    }
    {
      const _arr = args.task.readScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]));
      }
    }
    {
      const _arr = args.task.writeScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]));
      }
    }
    {
      const _arr = args.task.requirements;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]));
      }
    }
    {
      const _arr = args.task.completionChecks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(args.task.completionChecks[_i].id));
        parts.push(_pcEncodeString(args.task.completionChecks[_i].command));
        {
          const _arr = args.task.completionChecks[_i].args;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(_arr[_ii]));
          }
        }
        {
          const _opt = args.task.completionChecks[_i].workingDirectory;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        parts.push(_pcEncodeVarint64(args.task.completionChecks[_i].timeoutMs));
      }
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
      const _idx = _variants.indexOf(args.task.preferredCompute);
      if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + args.task.preferredCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
      const _idx = _variants.indexOf(args.task.minimumCompute);
      if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.task.minimumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
      const _idx = _variants.indexOf(args.task.maximumCompute);
      if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.task.maximumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    parts.push(_pcEncodeVarint(args.task.maxAttempts));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const cancelRunCodec: FrameCodec<RunInput, OperationOutput> = {
  commandId: 13,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 13, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: RunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 13; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const claimRunnableTasksCodec: FrameCodec<ClaimRunnableTasksInput, TaskIdsOutput> = {
  commandId: 6,
  execution: "sync",

  encode(args: ClaimRunnableTasksInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ClaimRunnableTasksInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 6, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    {
      const _arr = args.runningTaskIds;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]));
      }
    }
    parts.push(_pcEncodeVarint(args.maxWorkers));
    parts.push(_pcEncodeVarint(args.maxFrontierWorkers));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: TaskIdsOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<TaskIdsOutput> = {};
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: string[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _v = _pcDecodeString(u8, offset);
        _arr[_i] = _v.value;
        offset += _v.bytesRead;
      }
      result.taskIds = _arr;
    }
    return { ok: true, result: result as TaskIdsOutput };
  },
};

export const cleanupRunCodec: FrameCodec<CleanupRunInput, CleanupRunOutput> = {
  commandId: 17,
  execution: "sync",

  encode(args: CleanupRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(CleanupRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 17, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeVarint(args.keepRecent));
    parts.push(new Uint8Array([args.dryRun ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: CleanupRunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 17; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { let _v = args.keepRecent; do { ensure(1); out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; }
    { ensure(1); out[w++] = args.dryRun ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: CleanupRunOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<CleanupRunOutput> = {};
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: string[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _v = _pcDecodeString(u8, offset);
        _arr[_i] = _v.value;
        offset += _v.bytesRead;
      }
      result.removedArtifacts = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: SkippedArtifactOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: SkippedArtifactOutput = {} as SkippedArtifactOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.artifact = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.reason = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.skippedArtifacts = _arr;
    }
    return { ok: true, result: result as CleanupRunOutput };
  },
};

export const createRunCodec: FrameCodec<CreateRunInput, SnapshotOutput> = {
  commandId: 1,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: CreateRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(CreateRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 1, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: CreateRunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 1; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: SnapshotOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<SnapshotOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["active","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value];
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: TaskSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: TaskSnapshotOutput = {} as TaskSnapshotOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          _obj.kind = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          _obj.attempt = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.preferredCompute = _variants[_v.value];
        }
        _arr[_i] = _obj;
      }
      result.tasks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: ActiveWorkerOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: ActiveWorkerOutput = {} as ActiveWorkerOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.activeWorkers = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: string[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _v = _pcDecodeString(u8, offset);
        _arr[_i] = _v.value;
        offset += _v.bytesRead;
      }
      result.openAttentionIds = _arr;
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

export const getRunCodec: FrameCodec<RunInput, SnapshotOutput> = {
  commandId: 2,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 2, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: RunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 2; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: SnapshotOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<SnapshotOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["active","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value];
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: TaskSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: TaskSnapshotOutput = {} as TaskSnapshotOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          _obj.kind = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          _obj.attempt = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.preferredCompute = _variants[_v.value];
        }
        _arr[_i] = _obj;
      }
      result.tasks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: ActiveWorkerOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: ActiveWorkerOutput = {} as ActiveWorkerOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.activeWorkers = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: string[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _v = _pcDecodeString(u8, offset);
        _arr[_i] = _v.value;
        offset += _v.bytesRead;
      }
      result.openAttentionIds = _arr;
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

export const getSnapshotCodec: FrameCodec<RunInput, SnapshotOutput> = {
  commandId: 15,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 15, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: RunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 15; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: SnapshotOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<SnapshotOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["active","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value];
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: TaskSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: TaskSnapshotOutput = {} as TaskSnapshotOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          _obj.kind = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value];
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          _obj.attempt = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.preferredCompute = _variants[_v.value];
        }
        _arr[_i] = _obj;
      }
      result.tasks = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: ActiveWorkerOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: ActiveWorkerOutput = {} as ActiveWorkerOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.activeWorkers = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: string[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _v = _pcDecodeString(u8, offset);
        _arr[_i] = _v.value;
        offset += _v.bytesRead;
      }
      result.openAttentionIds = _arr;
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

export const recordDecisionCodec: FrameCodec<DecisionInput, OperationOutput> = {
  commandId: 10,
  execution: "sync",

  encode(args: DecisionInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(DecisionInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 10, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.decisionId));
    {
      const _opt = args.taskId;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    parts.push(_pcEncodeString(args.value));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const recordVerificationCodec: FrameCodec<VerificationInput, OperationOutput> = {
  commandId: 9,
  execution: "sync",

  encode(args: VerificationInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(VerificationInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 9, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(new Uint8Array([args.passed ? 1 : 0]));
    {
      const _arr = args.checks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(args.checks[_i].id));
        parts.push(new Uint8Array([args.checks[_i].passed ? 1 : 0]));
      }
    }
    parts.push(_pcEncodeString(args.reason));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const recordWorkerResultCodec: FrameCodec<WorkerResultInput, OperationOutput> = {
  commandId: 8,
  execution: "sync",

  encode(args: WorkerResultInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkerResultInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 8, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(_pcEncodeString(args.workerId));
    parts.push(new Uint8Array([args.success ? 1 : 0]));
    parts.push(_pcEncodeString(args.summary));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkerResultInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 8; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.taskId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.workerId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.success ? 1 : 0; }
    { const _s = args.summary; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const recordWorkerStartedCodec: FrameCodec<WorkerInput, OperationOutput> = {
  commandId: 7,
  execution: "sync",

  encode(args: WorkerInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(WorkerInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 7, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(_pcEncodeString(args.workerId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: WorkerInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 7; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.taskId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.workerId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const requestAttentionCodec: FrameCodec<RequestAttentionInput, OperationOutput> = {
  commandId: 11,
  execution: "sync",

  encode(args: RequestAttentionInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RequestAttentionInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 11, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.attentionId));
    {
      const _variants = ["question","decision","approval","conflict","failure"];
      const _idx = _variants.indexOf(args.kind);
      if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.kind);
      parts.push(_pcEncodeVarint(_idx));
    }
    parts.push(_pcEncodeString(args.summary));
    {
      const _opt = args.taskId;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const resolveAttentionCodec: FrameCodec<ResolveAttentionInput, OperationOutput> = {
  commandId: 12,
  execution: "sync",

  encode(args: ResolveAttentionInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ResolveAttentionInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 12, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.attentionId));
    parts.push(_pcEncodeString(args.resolution));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ResolveAttentionInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 12; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.attentionId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.resolution; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const resumeRunCodec: FrameCodec<RunInput, OperationOutput> = {
  commandId: 14,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 14, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: RunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 14; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] &= 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};

export const submitPlanCodec: FrameCodec<SubmitPlanInput, SubmitPlanOutput> = {
  commandId: 3,
  execution: "sync",

  encode(args: SubmitPlanInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(SubmitPlanInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 3, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    {
      const _arr = args.tasks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(args.tasks[_i].id));
        parts.push(_pcEncodeString(args.tasks[_i].title));
        {
          const _variants = ["research","decision","implementation","verification","integration"];
          const _idx = _variants.indexOf(args.tasks[_i].kind);
          if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.tasks[_i].kind);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _arr = args.tasks[_i].dependencies;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(_arr[_ii]));
          }
        }
        {
          const _arr = args.tasks[_i].readScope;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(_arr[_ii]));
          }
        }
        {
          const _arr = args.tasks[_i].writeScope;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(_arr[_ii]));
          }
        }
        {
          const _arr = args.tasks[_i].requirements;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(_arr[_ii]));
          }
        }
        {
          const _arr = args.tasks[_i].completionChecks;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _ii = 0; _ii < _arr.length; _ii++) {
            parts.push(_pcEncodeString(args.tasks[_i].completionChecks[_ii].id));
            parts.push(_pcEncodeString(args.tasks[_i].completionChecks[_ii].command));
            {
              const _arr = args.tasks[_i].completionChecks[_ii].args;
              parts.push(_pcEncodeVarint(_arr.length));
              for (let _iii = 0; _iii < _arr.length; _iii++) {
                parts.push(_pcEncodeString(_arr[_iii]));
              }
            }
            {
              const _opt = args.tasks[_i].completionChecks[_ii].workingDirectory;
              if (_opt === null || _opt === undefined) {
                parts.push(new Uint8Array([0]));
              } else {
                parts.push(new Uint8Array([1]));
                parts.push(_pcEncodeString(_opt));
              }
            }
            parts.push(_pcEncodeVarint64(args.tasks[_i].completionChecks[_ii].timeoutMs));
          }
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
          const _idx = _variants.indexOf(args.tasks[_i].preferredCompute);
          if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + args.tasks[_i].preferredCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
          const _idx = _variants.indexOf(args.tasks[_i].minimumCompute);
          if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.tasks[_i].minimumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"];
          const _idx = _variants.indexOf(args.tasks[_i].maximumCompute);
          if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.tasks[_i].maximumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        parts.push(_pcEncodeVarint(args.tasks[_i].maxAttempts));
      }
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: SubmitPlanOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<SubmitPlanOutput> = {};
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.taskCount = _v.value;
      offset += _v.bytesRead;
    }
    return { ok: true, result: result as SubmitPlanOutput };
  },
};

export const subscribeEventsCodec = createSchemaPostcardCodec(16, {"title":"SubscribeEventsInput","type":"object","required":["afterSequence","databasePath","limit","runId"],"properties":{"databasePath":{"type":"string"},"runId":{"type":"string"},"afterSequence":{"type":"integer","format":"int64"},"limit":{"type":"integer","format":"uint16","minimum":0}}} as ComplexSchema, {"title":"Array_of_EventOutput","type":"array","items":{"$ref":"#/definitions/EventOutput"}} as ComplexSchema, {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"RunState":{"type":"string","enum":["active","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["attempt","id","kind","preferredCompute","state","title"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>, true)! as FrameCodec<SubscribeEventsInput, Array_of_EventOutput>;

export const updateTaskCodec: FrameCodec<UpdateTaskInput, OperationOutput> = {
  commandId: 5,
  execution: "sync",

  encode(args: UpdateTaskInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(UpdateTaskInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 5, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    {
      const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"];
      const _idx = _variants.indexOf(args.state);
      if (_idx < 0) throw new Error('invalid enum value for state: ' + args.state);
      parts.push(_pcEncodeVarint(_idx));
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: OperationOutput; error?: RustraError } {
    // caller-buffer 뷰(Uint8Array subarray 등)도 받는다 — node-loop 가 왕복당
    // 사본 없이 프레임 뷰를 그대로 넘긴다. DataView 는 ArrayBuffer 만 받으므로
    // (buf.buffer, byteOffset) 로 정규화한다.
    const isView = ArrayBuffer.isView(buf);
    const u8 = isView
      ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      : new Uint8Array(buf);
    const view = isView
      ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
      : new DataView(buf);
    if (view.byteLength < 8) return { ok: false, error: { code: 'invoke.too_short', message: 'response too short' } };
    if (u8[0] !== 1) {
      let err: RustraError = { code: 'invoke.failed', message: 'invoke failed' };
      try {
        const errLen = view.getUint16(8, true);
        if (errLen > 0) {
          // postcard({ code: String, message: String })
          const c = _pcDecodeString(u8, 10);
          const m = _pcDecodeString(u8, 10 + c.bytesRead);
          err = { code: c.value, message: m.value };
        }
      } catch {
        // 잘린/뒤틀린 에러 프레임 — 기본 err 를 유지한다.
      }
      return { ok: false, error: err };
    }
    // Decode postcard from offset 8
    let offset = 8;
    const result: Partial<OperationOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    return { ok: true, result: result as OperationOutput };
  },
};
