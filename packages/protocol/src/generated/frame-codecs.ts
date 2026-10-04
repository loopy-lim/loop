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
    const b = bytes[i]!;
    if (b < 0x80) { s += String.fromCharCode(b); i += 1; }
    else if ((b & 0xe0) === 0xc0) { s += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1]! & 0x3f)); i += 2; }
    else if ((b & 0xf0) === 0xe0) { s += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1]! & 0x3f) << 6) | (bytes[i + 2]! & 0x3f)); i += 3; }
    else if ((b & 0xf8) === 0xf0) { const cp = ((b & 0x07) << 18) | ((bytes[i + 1]! & 0x3f) << 12) | ((bytes[i + 2]! & 0x3f) << 6) | (bytes[i + 3]! & 0x3f); const adj = cp - 0x10000; s += String.fromCharCode(0xd800 + (adj >> 10), 0xdc00 + (adj & 0x3ff)); i += 4; }
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
import type { ActiveWorkerOutput, AddGoalTaskInput, AddTaskInput, AppendGoalCriteriaInput, Array_of_EventOutput, Array_of_RunListOutput, AssumptionInput, AttentionKind, AttentionSnapshotOutput, BackoffPolicy, CapabilityRequirementsInput, CheckReceipt, CheckResultInput, ClaimRunnableTasksInput, CleanupDisposition, CleanupDispositionOutput, CleanupRunInput, CleanupRunOutput, CompareTracesInput, CompareTracesOutput, CompletionCheckInput, CompletionCoverageInput, ComputeCandidateInput, ComputeCapabilities, ComputeCapabilitiesInput, ComputeClass, ConfigureRunInput, CreateRunInput, DecisionInput, DecompositionContractOutput, DependencyConsumptionInput, DependencyResultOutput, DependencyTerminalization, EvaluateCleanupDispositionInput, EvaluateFailurePolicyInput, EvaluateSurfaceRemovalInput, EvaluateWorktreeRemovalInput, EventOutput, EvidenceLevel, ExecutionLeaseInput, FailureClass, FailurePolicy, FailurePolicyAction, FailurePolicyOutput, GetTraceInput, GetTraceOutput, GoalCriterionInput, GoalCriterionState, GoalCriterionStatusOutput, GraphNodeOutput, GraphOwnerHealth, GuidanceDeliveredEvent, IndependentBranchAction, ListRunsInput, OnExhaustion, OperationOutput, PolicyEvaluationOutput, PreflightTaskSpecInput, PrepareGoalRunInput, PrepareRunInput, PrepareRunPreflightInput, PromoteSteerInput, PromoteSteerOutput, ReconcileTaskInput, RecordActivityInput, RecordCheckReceiptsInput, RecordGuidanceDeliveredInput, RecordTaskOutputInput, RefusalCode, ReleaseExecutionInput, RequestAttentionInput, ResolveAttentionInput, RetryBudget, RetryScope, Risk, RoutingRisk, RunFailureAction, RunGraphInput, RunGraphOutput, RunInput, RunListOutput, RunPlanOutput, RunState, SelectCandidateInput, SelectCandidateOutput, SemanticAccess, SemanticConflictResolution, SemanticTouchpointInput, SkippedArtifactOutput, SnapshotOutput, SourceReceipt, SteerRunInput, StopVerificationInput, SubmitPlanInput, SubmitPlanOutput, SubscribeEventsInput, TaskContextInput, TaskContextOutput, TaskIdsOutput, TaskKind, TaskRouting, TaskSnapshotOutput, TaskSpecInput, TaskState, TerminalizationPolicy, TraceComparison, TraceRanking, TraceReportEntry, TraceScore, TraceSummary, UpdateTaskInput, VerificationInput, WorkerInput, WorkerResultInput, WorkerState } from './types.js';

export const addGoalTaskCodec: FrameCodec<AddGoalTaskInput, OperationOutput> = {
  commandId: 29,
  execution: "sync",

  encode(args: AddGoalTaskInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(AddGoalTaskInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 29, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.task.id));
    parts.push(_pcEncodeString(args.task.title));
    {
      const _variants = ["research","decision","implementation","verification","integration"] as const;
      const _idx = _variants.indexOf(args.task.kind);
      if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.task.kind);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _arr = args.task.dependencies;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.readScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.writeScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.requirements;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _opt = args.task.persona;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    {
      const _arr = args.task.completionChecks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.command));
        {
          const _arri = _arr[_i]!.args;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.workingDirectory;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        parts.push(_pcEncodeVarint64(_arr[_i]!.timeoutMs));
      }
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.preferredCompute);
      if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + args.task.preferredCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.minimumCompute);
      if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.task.minimumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.maximumCompute);
      if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.task.maximumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _opt = args.task.routing;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        {
          const _variants = ["low","medium","high","critical"] as const;
          const _idx = _variants.indexOf(_opt.risk);
          if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
          parts.push(_pcEncodeVarint(_idx));
        }
        parts.push(_pcEncodeVarint(_opt.required.coding));
        parts.push(_pcEncodeVarint(_opt.required.reasoning));
        parts.push(_pcEncodeVarint(_opt.required.tools));
        parts.push(_pcEncodeVarint(_opt.required.vision));
        parts.push(_pcEncodeVarint(_opt.required.long_context));
      }
    }
    parts.push(_pcEncodeVarint(args.task.maxAttempts));
    {
      const _arr = args.criteria;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.description));
        parts.push(_pcEncodeString(_arr[_i]!.taskId));
        {
          const _arri = _arr[_i]!.checkIds;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
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
      const _variants = ["research","decision","implementation","verification","integration"] as const;
      const _idx = _variants.indexOf(args.task.kind);
      if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.task.kind);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _arr = args.task.dependencies;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.readScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.writeScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.requirements;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _opt = args.task.persona;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    {
      const _arr = args.task.completionChecks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.command));
        {
          const _arri = _arr[_i]!.args;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.workingDirectory;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        parts.push(_pcEncodeVarint64(_arr[_i]!.timeoutMs));
      }
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.preferredCompute);
      if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + args.task.preferredCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.minimumCompute);
      if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.task.minimumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.maximumCompute);
      if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.task.maximumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _opt = args.task.routing;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        {
          const _variants = ["low","medium","high","critical"] as const;
          const _idx = _variants.indexOf(_opt.risk);
          if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
          parts.push(_pcEncodeVarint(_idx));
        }
        parts.push(_pcEncodeVarint(_opt.required.coding));
        parts.push(_pcEncodeVarint(_opt.required.reasoning));
        parts.push(_pcEncodeVarint(_opt.required.tools));
        parts.push(_pcEncodeVarint(_opt.required.vision));
        parts.push(_pcEncodeVarint(_opt.required.long_context));
      }
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

export const appendGoalCriteriaCodec: FrameCodec<AppendGoalCriteriaInput, OperationOutput> = {
  commandId: 28,
  execution: "sync",

  encode(args: AppendGoalCriteriaInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(AppendGoalCriteriaInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 28, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    {
      const _arr = args.criteria;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.description));
        parts.push(_pcEncodeString(_arr[_i]!.taskId));
        {
          const _arri = _arr[_i]!.checkIds;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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

export const claimExecutionCodec: FrameCodec<ExecutionLeaseInput, OperationOutput> = {
  commandId: 39,
  execution: "sync",

  encode(args: ExecutionLeaseInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ExecutionLeaseInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 39, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.owner));
    parts.push(_pcEncodeZigzag64(args.nowMs));
    parts.push(_pcEncodeZigzag64(args.ttlMs));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ExecutionLeaseInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 39; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.owner; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { let _x = BigInt(args.nowMs); if (_x < _pcI64Min || _x > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + _x.toString()); _x = (_x << 1n) ^ (_x >> 63n); do { ensure(1); out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] = out[w - 1]! & 0x7f; }
    { let _x = BigInt(args.ttlMs); if (_x < _pcI64Min || _x > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + _x.toString()); _x = (_x << 1n) ^ (_x >> 63n); do { ensure(1); out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] = out[w - 1]! & 0x7f; }
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
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    parts.push(_pcEncodeVarint(args.maxWorkers));
    parts.push(_pcEncodeVarint(args.maxFrontierWorkers));
    {
      const _opt = args.executionOwner;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
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
  commandId: 21,
  execution: "sync",

  encode(args: CleanupRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(CleanupRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 21, true);
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
    out[w++] = 21; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { let _v = args.keepRecent; do { ensure(1); out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; }
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

export const compareTracesCodec: FrameCodec<CompareTracesInput, CompareTracesOutput> = {
  commandId: 25,
  execution: "sync",

  encode(args: CompareTracesInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(CompareTracesInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 25, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    {
      const _arr = args.runIds;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: CompareTracesOutput; error?: RustraError } {
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
    const result: Partial<CompareTracesOutput> = {};
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: TraceReportEntry[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: TraceReportEntry = {} as TraceReportEntry;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.runId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _obj8: TraceSummary = {} as TraceSummary;
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.total_events = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.tasks_created = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.tasks_completed = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.worker_starts = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.worker_finishes = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.worker_failures = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.verification_passes = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.verification_failures = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.attention_created = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.attention_resolved = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _tag = u8[offset];
            offset += 1;
            if (_tag === 0) {
              _obj8.elapsed_ms = null;
            } else {
              {
                const _v = _pcDecodeVarint64(u8, offset);
                _obj8.elapsed_ms = _v.value;
                offset += _v.bytesRead;
              }
            }
          }
          _obj.summary = _obj8;
        }
        {
          const _obj8: TraceScore = {} as TraceScore;
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.reliability = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.autonomy = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeVarint(u8, offset);
            _obj8.first_pass = _v.value;
            offset += _v.bytesRead;
          }
          _obj.score = _obj8;
        }
        _arr[_i] = _obj;
      }
      result.entries = _arr;
    }
    {
      const _obj: TraceComparison = {} as TraceComparison;
      {
        const _len = _pcDecodeVarint(u8, offset);
        offset += _len.bytesRead;
        const _arr: TraceRanking[] = new Array(_len.value);
        for (let _i = 0; _i < _len.value; _i++) {
          const _obj: TraceRanking = {} as TraceRanking;
          {
            const _v = _pcDecodeString(u8, offset);
            _obj.label = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _obj10: TraceScore = {} as TraceScore;
            {
              const _v = _pcDecodeVarint(u8, offset);
              _obj10.reliability = _v.value;
              offset += _v.bytesRead;
            }
            {
              const _v = _pcDecodeVarint(u8, offset);
              _obj10.autonomy = _v.value;
              offset += _v.bytesRead;
            }
            {
              const _v = _pcDecodeVarint(u8, offset);
              _obj10.first_pass = _v.value;
              offset += _v.bytesRead;
            }
            _obj.score = _obj10;
          }
          _arr[_i] = _obj;
        }
        _obj.rankings = _arr;
      }
      result.comparison = _obj;
    }
    return { ok: true, result: result as CompareTracesOutput };
  },
};

export const configureRunCodec: FrameCodec<ConfigureRunInput, OperationOutput> = {
  commandId: 30,
  execution: "sync",

  encode(args: ConfigureRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ConfigureRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 30, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.intent));
    parts.push(_pcEncodeString(args.workingDirectory));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ConfigureRunInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 30; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.intent; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.workingDirectory; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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

export const confirmPausedCodec: FrameCodec<RunInput, OperationOutput> = {
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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
      const _variants = ["active","pausing","paused","cancelling","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value]!;
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
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value]!;
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
          _obj.preferredCompute = _variants[_v.value]!;
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
          _obj.dependencies = _arr;
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
          _obj.readScope = _arr;
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
          _obj.writeScope = _arr;
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
          _obj.blockedBy = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastFailure = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastFailure = _v.value;
              offset += _v.bytesRead;
            }
          }
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
          _obj.activities = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastProgressMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.lastProgressMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.resultSummary = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.resultSummary = _v.value;
              offset += _v.bytesRead;
            }
          }
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
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: AttentionSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: AttentionSnapshotOutput = {} as AttentionSnapshotOutput;
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.openedAtMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.openedAtMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["question","decision","approval","conflict","failure"] as const;
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.summary = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.taskId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.taskId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.attention = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.intent = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.workingDirectory = _v.value;
      offset += _v.bytesRead;
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
      result.guidance = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: GoalCriterionStatusOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: GoalCriterionStatusOutput = {} as GoalCriterionStatusOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.description = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
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
          _obj.checkIds = _arr;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","verified"] as const;
          _obj.state = _variants[_v.value]!;
        }
        _arr[_i] = _obj;
      }
      result.goalCriteria = _arr;
    }
    {
      const _v = _pcDecodeVarint64(u8, offset);
      result.lastSequence = _pcDecodeZigzag64(_v.value);
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionOwner = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.executionOwner = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionExpiresAt = null;
      } else {
        {
          const _v = _pcDecodeVarint64(u8, offset);
          result.executionExpiresAt = _pcDecodeZigzag64(_v.value);
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const evaluateCleanupDispositionComplexCodec: FrameCodec<EvaluateCleanupDispositionInput, CleanupDispositionOutput> = createComplexCodec<EvaluateCleanupDispositionInput, CleanupDispositionOutput>({
  commandId: 46,
  execution: "sync",
  inputSchema: {"title":"EvaluateCleanupDispositionInput","type":"object","required":["refusalCode"],"properties":{"refusalCode":{"$ref":"#/definitions/RefusalCode"}}} as ComplexSchema,
  outputSchema: {"title":"CleanupDispositionOutput","type":"object","required":["disposition"],"properties":{"disposition":{"$ref":"#/definitions/CleanupDisposition"}}} as ComplexSchema,
  definitions: {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const evaluateCleanupDispositionCodec = evaluateCleanupDispositionComplexCodec;

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const evaluateFailurePolicyComplexCodec: FrameCodec<EvaluateFailurePolicyInput, FailurePolicyOutput> = createComplexCodec<EvaluateFailurePolicyInput, FailurePolicyOutput>({
  commandId: 45,
  execution: "sync",
  inputSchema: {"title":"EvaluateFailurePolicyInput","type":"object","required":["failureClass","failurePolicy","retriesUsed","taskKind","terminalizationPolicy"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"retriesUsed":{"type":"integer","format":"uint16","minimum":0},"taskKind":{"$ref":"#/definitions/TaskKind"},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"},"terminalizationPolicy":{"$ref":"#/definitions/TerminalizationPolicy"}}} as ComplexSchema,
  outputSchema: {"title":"FailurePolicyOutput","type":"object","required":["action"],"properties":{"action":{"$ref":"#/definitions/FailurePolicyAction"},"retryScope":{"anyOf":[{"$ref":"#/definitions/RetryScope"},{"type":"null"}]},"delayMs":{"type":["integer","null"],"format":"uint64","minimum":0},"dependents":{"anyOf":[{"$ref":"#/definitions/DependencyTerminalization"},{"type":"null"}]},"independentBranches":{"anyOf":[{"$ref":"#/definitions/IndependentBranchAction"},{"type":"null"}]},"run":{"anyOf":[{"$ref":"#/definitions/RunFailureAction"},{"type":"null"}]}}} as ComplexSchema,
  definitions: {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const evaluateFailurePolicyCodec = evaluateFailurePolicyComplexCodec;

export const evaluateSurfaceRemovalCodec: FrameCodec<EvaluateSurfaceRemovalInput, PolicyEvaluationOutput> = {
  commandId: 23,
  execution: "sync",
  syncFields: ["surfaceId","isOwnedByLoop"],

  encode(args: EvaluateSurfaceRemovalInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(EvaluateSurfaceRemovalInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 23, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.surfaceId));
    parts.push(new Uint8Array([args.isOwnedByLoop ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: EvaluateSurfaceRemovalInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 23; out[w++] = 0;
    { const _s = args.surfaceId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.isOwnedByLoop ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: PolicyEvaluationOutput; error?: RustraError } {
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
    const result: Partial<PolicyEvaluationOutput> = {};
    {
      result.allowed = u8[offset] === 1;
      offset += 1;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.refusalCode = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.refusalCode = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.reason = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.reason = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as PolicyEvaluationOutput };
  },
};

export const evaluateWorktreeRemovalCodec: FrameCodec<EvaluateWorktreeRemovalInput, PolicyEvaluationOutput> = {
  commandId: 22,
  execution: "sync",

  encode(args: EvaluateWorktreeRemovalInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(EvaluateWorktreeRemovalInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 22, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.projectRoot));
    parts.push(_pcEncodeString(args.worktreePath));
    parts.push(new Uint8Array([args.isMerged ? 1 : 0]));
    parts.push(new Uint8Array([args.isClean ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: EvaluateWorktreeRemovalInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 22; out[w++] = 0;
    { const _s = args.projectRoot; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.worktreePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.isMerged ? 1 : 0; }
    { ensure(1); out[w++] = args.isClean ? 1 : 0; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: PolicyEvaluationOutput; error?: RustraError } {
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
    const result: Partial<PolicyEvaluationOutput> = {};
    {
      result.allowed = u8[offset] === 1;
      offset += 1;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.refusalCode = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.refusalCode = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.reason = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.reason = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as PolicyEvaluationOutput };
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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
      const _variants = ["active","pausing","paused","cancelling","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value]!;
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
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value]!;
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
          _obj.preferredCompute = _variants[_v.value]!;
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
          _obj.dependencies = _arr;
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
          _obj.readScope = _arr;
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
          _obj.writeScope = _arr;
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
          _obj.blockedBy = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastFailure = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastFailure = _v.value;
              offset += _v.bytesRead;
            }
          }
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
          _obj.activities = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastProgressMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.lastProgressMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.resultSummary = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.resultSummary = _v.value;
              offset += _v.bytesRead;
            }
          }
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
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: AttentionSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: AttentionSnapshotOutput = {} as AttentionSnapshotOutput;
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.openedAtMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.openedAtMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["question","decision","approval","conflict","failure"] as const;
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.summary = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.taskId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.taskId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.attention = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.intent = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.workingDirectory = _v.value;
      offset += _v.bytesRead;
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
      result.guidance = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: GoalCriterionStatusOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: GoalCriterionStatusOutput = {} as GoalCriterionStatusOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.description = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
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
          _obj.checkIds = _arr;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","verified"] as const;
          _obj.state = _variants[_v.value]!;
        }
        _arr[_i] = _obj;
      }
      result.goalCriteria = _arr;
    }
    {
      const _v = _pcDecodeVarint64(u8, offset);
      result.lastSequence = _pcDecodeZigzag64(_v.value);
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionOwner = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.executionOwner = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionExpiresAt = null;
      } else {
        {
          const _v = _pcDecodeVarint64(u8, offset);
          result.executionExpiresAt = _pcDecodeZigzag64(_v.value);
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

export const getRunGraphCodec: FrameCodec<RunGraphInput, RunGraphOutput> = {
  commandId: 19,
  execution: "sync",
  syncFields: ["databasePath","runId","nowMs"],

  encode(args: RunGraphInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunGraphInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 19, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeZigzag64(args.nowMs));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: RunGraphInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 19; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { let _x = BigInt(args.nowMs); if (_x < _pcI64Min || _x > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + _x.toString()); _x = (_x << 1n) ^ (_x >> 63n); do { ensure(1); out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] = out[w - 1]! & 0x7f; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: RunGraphOutput; error?: RustraError } {
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
    const result: Partial<RunGraphOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["active","pausing","paused","cancelling","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value]!;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.lastSequence = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["live","missing","expired","inactive"] as const;
      result.ownerHealth = _variants[_v.value]!;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.openAttentionCount = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: GraphNodeOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: GraphNodeOutput = {} as GraphNodeOutput;
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
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value]!;
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
          _obj.dependencies = _arr;
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
          _obj.blockedBy = _arr;
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
          _obj.readScope = _arr;
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
          _obj.writeScope = _arr;
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
          _obj.workers = _arr;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          _obj.attempt = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.resultSummary = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.resultSummary = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastFailure = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastFailure = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.nodes = _arr;
    }
    return { ok: true, result: result as RunGraphOutput };
  },
};

export const getRunPlanCodec: FrameCodec<RunInput, RunPlanOutput> = {
  commandId: 31,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 31, true);
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
    out[w++] = 31; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: RunPlanOutput; error?: RustraError } {
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
    const result: Partial<RunPlanOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.intent = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.workingDirectory = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: TaskSpecInput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: TaskSpecInput = {} as TaskSpecInput;
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
          _obj.kind = _variants[_v.value]!;
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
          _obj.dependencies = _arr;
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
          _obj.readScope = _arr;
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
          _obj.writeScope = _arr;
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
          _obj.requirements = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.persona = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.persona = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _len = _pcDecodeVarint(u8, offset);
          offset += _len.bytesRead;
          const _arr: CompletionCheckInput[] = new Array(_len.value);
          for (let _i = 0; _i < _len.value; _i++) {
            const _obj: CompletionCheckInput = {} as CompletionCheckInput;
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.id = _v.value;
              offset += _v.bytesRead;
            }
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.command = _v.value;
              offset += _v.bytesRead;
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
              _obj.args = _arr;
            }
            {
              const _tag = u8[offset];
              offset += 1;
              if (_tag === 0) {
                _obj.workingDirectory = null;
              } else {
                {
                  const _v = _pcDecodeString(u8, offset);
                  _obj.workingDirectory = _v.value;
                  offset += _v.bytesRead;
                }
              }
            }
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.timeoutMs = _v.value;
              offset += _v.bytesRead;
            }
            _arr[_i] = _obj;
          }
          _obj.completionChecks = _arr;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.preferredCompute = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.minimumCompute = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          _obj.maximumCompute = _variants[_v.value]!;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.routing = null;
          } else {
            {
              const _obj12: TaskRouting = {} as TaskRouting;
              {
                const _v = _pcDecodeVarint(u8, offset);
                offset += _v.bytesRead;
                const _variants = ["low","medium","high","critical"] as const;
                _obj12.risk = _variants[_v.value]!;
              }
              {
                const _obj14: ComputeCapabilities = {} as ComputeCapabilities;
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj14.coding = _v.value;
                  offset += _v.bytesRead;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj14.reasoning = _v.value;
                  offset += _v.bytesRead;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj14.tools = _v.value;
                  offset += _v.bytesRead;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj14.vision = _v.value;
                  offset += _v.bytesRead;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj14.long_context = _v.value;
                  offset += _v.bytesRead;
                }
                _obj12.required = _obj14;
              }
              _obj.routing = _obj12;
            }
          }
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          _obj.maxAttempts = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.tasks = _arr;
    }
    return { ok: true, result: result as RunPlanOutput };
  },
};

export const getSnapshotCodec: FrameCodec<RunInput, SnapshotOutput> = {
  commandId: 18,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 18, true);
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
    out[w++] = 18; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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
      const _variants = ["active","pausing","paused","cancelling","attention","completed","failed","cancelled"] as const;
      result.state = _variants[_v.value]!;
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
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
          _obj.state = _variants[_v.value]!;
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
          _obj.preferredCompute = _variants[_v.value]!;
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
          _obj.dependencies = _arr;
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
          _obj.readScope = _arr;
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
          _obj.writeScope = _arr;
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
          _obj.blockedBy = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastFailure = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.lastFailure = _v.value;
              offset += _v.bytesRead;
            }
          }
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
          _obj.activities = _arr;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.lastProgressMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.lastProgressMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.resultSummary = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.resultSummary = _v.value;
              offset += _v.bytesRead;
            }
          }
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
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: AttentionSnapshotOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: AttentionSnapshotOutput = {} as AttentionSnapshotOutput;
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.openedAtMs = null;
          } else {
            {
              const _v = _pcDecodeVarint64(u8, offset);
              _obj.openedAtMs = _pcDecodeZigzag64(_v.value);
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["question","decision","approval","conflict","failure"] as const;
          _obj.kind = _variants[_v.value]!;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.summary = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.taskId = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.taskId = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.attention = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.intent = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.workingDirectory = _v.value;
      offset += _v.bytesRead;
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
      result.guidance = _arr;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: GoalCriterionStatusOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: GoalCriterionStatusOutput = {} as GoalCriterionStatusOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.description = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
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
          _obj.checkIds = _arr;
        }
        {
          const _v = _pcDecodeVarint(u8, offset);
          offset += _v.bytesRead;
          const _variants = ["pending","verified"] as const;
          _obj.state = _variants[_v.value]!;
        }
        _arr[_i] = _obj;
      }
      result.goalCriteria = _arr;
    }
    {
      const _v = _pcDecodeVarint64(u8, offset);
      result.lastSequence = _pcDecodeZigzag64(_v.value);
      offset += _v.bytesRead;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionOwner = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.executionOwner = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.executionExpiresAt = null;
      } else {
        {
          const _v = _pcDecodeVarint64(u8, offset);
          result.executionExpiresAt = _pcDecodeZigzag64(_v.value);
          offset += _v.bytesRead;
        }
      }
    }
    return { ok: true, result: result as SnapshotOutput };
  },
};

export const getTaskContextCodec: FrameCodec<TaskContextInput, TaskContextOutput> = {
  commandId: 32,
  execution: "sync",
  syncFields: ["databasePath","runId","taskId"],

  encode(args: TaskContextInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(TaskContextInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 32, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: TaskContextInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 32; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.taskId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: TaskContextOutput; error?: RustraError } {
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
    const result: Partial<TaskContextOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.intent = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.workingDirectory = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _obj: TaskSpecInput = {} as TaskSpecInput;
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
        _obj.kind = _variants[_v.value]!;
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
        _obj.dependencies = _arr;
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
        _obj.readScope = _arr;
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
        _obj.writeScope = _arr;
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
        _obj.requirements = _arr;
      }
      {
        const _tag = u8[offset];
        offset += 1;
        if (_tag === 0) {
          _obj.persona = null;
        } else {
          {
            const _v = _pcDecodeString(u8, offset);
            _obj.persona = _v.value;
            offset += _v.bytesRead;
          }
        }
      }
      {
        const _len = _pcDecodeVarint(u8, offset);
        offset += _len.bytesRead;
        const _arr: CompletionCheckInput[] = new Array(_len.value);
        for (let _i = 0; _i < _len.value; _i++) {
          const _obj: CompletionCheckInput = {} as CompletionCheckInput;
          {
            const _v = _pcDecodeString(u8, offset);
            _obj.id = _v.value;
            offset += _v.bytesRead;
          }
          {
            const _v = _pcDecodeString(u8, offset);
            _obj.command = _v.value;
            offset += _v.bytesRead;
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
            _obj.args = _arr;
          }
          {
            const _tag = u8[offset];
            offset += 1;
            if (_tag === 0) {
              _obj.workingDirectory = null;
            } else {
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.workingDirectory = _v.value;
                offset += _v.bytesRead;
              }
            }
          }
          {
            const _v = _pcDecodeVarint64(u8, offset);
            _obj.timeoutMs = _v.value;
            offset += _v.bytesRead;
          }
          _arr[_i] = _obj;
        }
        _obj.completionChecks = _arr;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        offset += _v.bytesRead;
        const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
        _obj.preferredCompute = _variants[_v.value]!;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        offset += _v.bytesRead;
        const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
        _obj.minimumCompute = _variants[_v.value]!;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        offset += _v.bytesRead;
        const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
        _obj.maximumCompute = _variants[_v.value]!;
      }
      {
        const _tag = u8[offset];
        offset += 1;
        if (_tag === 0) {
          _obj.routing = null;
        } else {
          {
            const _obj10: TaskRouting = {} as TaskRouting;
            {
              const _v = _pcDecodeVarint(u8, offset);
              offset += _v.bytesRead;
              const _variants = ["low","medium","high","critical"] as const;
              _obj10.risk = _variants[_v.value]!;
            }
            {
              const _obj12: ComputeCapabilities = {} as ComputeCapabilities;
              {
                const _v = _pcDecodeVarint(u8, offset);
                _obj12.coding = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                _obj12.reasoning = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                _obj12.tools = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                _obj12.vision = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                _obj12.long_context = _v.value;
                offset += _v.bytesRead;
              }
              _obj10.required = _obj12;
            }
            _obj.routing = _obj10;
          }
        }
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.maxAttempts = _v.value;
        offset += _v.bytesRead;
      }
      result.task = _obj;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.decompositionContract = null;
      } else {
        {
          const _obj: DecompositionContractOutput = {} as DecompositionContractOutput;
          {
            const _len = _pcDecodeVarint(u8, offset);
            offset += _len.bytesRead;
            const _arr: string[] = new Array(_len.value);
            for (let _i = 0; _i < _len.value; _i++) {
              const _v = _pcDecodeString(u8, offset);
              _arr[_i] = _v.value;
              offset += _v.bytesRead;
            }
            _obj.defaults = _arr;
          }
          {
            const _len = _pcDecodeVarint(u8, offset);
            offset += _len.bytesRead;
            const _arr: AssumptionInput[] = new Array(_len.value);
            for (let _i = 0; _i < _len.value; _i++) {
              const _obj: AssumptionInput = {} as AssumptionInput;
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.assumption = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.evidence = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.ifFalse = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.revisit = _v.value;
                offset += _v.bytesRead;
              }
              _arr[_i] = _obj;
            }
            _obj.assumptions = _arr;
          }
          {
            const _len = _pcDecodeVarint(u8, offset);
            offset += _len.bytesRead;
            const _arr: SemanticTouchpointInput[] = new Array(_len.value);
            for (let _i = 0; _i < _len.value; _i++) {
              const _obj: SemanticTouchpointInput = {} as SemanticTouchpointInput;
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.id = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                offset += _v.bytesRead;
                const _variants = ["consume","modify"] as const;
                _obj.access = _variants[_v.value]!;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                offset += _v.bytesRead;
                const _variants = ["unresolved","serialize","dependency_order"] as const;
                _obj.conflictResolution = _variants[_v.value]!;
              }
              _arr[_i] = _obj;
            }
            _obj.semanticTouchpoints = _arr;
          }
          {
            const _len = _pcDecodeVarint(u8, offset);
            offset += _len.bytesRead;
            const _arr: DependencyConsumptionInput[] = new Array(_len.value);
            for (let _i = 0; _i < _len.value; _i++) {
              const _obj: DependencyConsumptionInput = {} as DependencyConsumptionInput;
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.dependency = _v.value;
                offset += _v.bytesRead;
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
                _obj.decisions = _arr;
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
                _obj.artifacts = _arr;
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
                _obj.checks = _arr;
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
                _obj.risks = _arr;
              }
              _arr[_i] = _obj;
            }
            _obj.consumes = _arr;
          }
          {
            const _len = _pcDecodeVarint(u8, offset);
            offset += _len.bytesRead;
            const _arr: CompletionCoverageInput[] = new Array(_len.value);
            for (let _i = 0; _i < _len.value; _i++) {
              const _obj: CompletionCoverageInput = {} as CompletionCoverageInput;
              {
                const _v = _pcDecodeString(u8, offset);
                _obj.checkId = _v.value;
                offset += _v.bytesRead;
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
                _obj.requirements = _arr;
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
                _obj.artifacts = _arr;
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
                _obj.semantics = _arr;
              }
              {
                const _v = _pcDecodeVarint(u8, offset);
                offset += _v.bytesRead;
                const _variants = ["static","unit","fake","integration","live"] as const;
                _obj.evidenceLevel = _variants[_v.value]!;
              }
              _arr[_i] = _obj;
            }
            _obj.completionCoverage = _arr;
          }
          {
            const _obj10: FailurePolicy = {} as FailurePolicy;
            {
              const _len = _pcDecodeVarint(u8, offset);
              offset += _len.bytesRead;
              const _arr: RetryBudget[] = new Array(_len.value);
              for (let _i = 0; _i < _len.value; _i++) {
                const _obj: RetryBudget = {} as RetryBudget;
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  offset += _v.bytesRead;
                  const _variants = ["assertion","timeout","process_start","invalid_contract","interrupted","environment"] as const;
                  _obj.failureClass = _variants[_v.value]!;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  offset += _v.bytesRead;
                  const _variants = ["check","candidate","worker","compute"] as const;
                  _obj.scope = _variants[_v.value]!;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  _obj.maxRetries = _v.value;
                  offset += _v.bytesRead;
                }
                {
                  const _obj16: BackoffPolicy = {} as BackoffPolicy;
                  {
                    const _v = _pcDecodeVarint64(u8, offset);
                    _obj16.initialDelayMs = _v.value;
                    offset += _v.bytesRead;
                  }
                  {
                    const _v = _pcDecodeVarint(u8, offset);
                    _obj16.multiplier = _v.value;
                    offset += _v.bytesRead;
                  }
                  {
                    const _v = _pcDecodeVarint64(u8, offset);
                    _obj16.maxDelayMs = _v.value;
                    offset += _v.bytesRead;
                  }
                  _obj.backoff = _obj16;
                }
                {
                  const _v = _pcDecodeVarint(u8, offset);
                  offset += _v.bytesRead;
                  const _variants = ["fail_task","require_attention"] as const;
                  _obj.onExhaustion = _variants[_v.value]!;
                }
                _arr[_i] = _obj;
              }
              _obj10.retryBudgets = _arr;
            }
            {
              const _v = _pcDecodeVarint(u8, offset);
              offset += _v.bytesRead;
              const _variants = ["fail_task","require_attention"] as const;
              _obj10.onUnbudgetedFailure = _variants[_v.value]!;
            }
            _obj.failurePolicy = _obj10;
          }
          result.decompositionContract = _obj;
        }
      }
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      result.attempt = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: DependencyResultOutput[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: DependencyResultOutput = {} as DependencyResultOutput;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.taskId = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.title = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.summary = _v.value;
          offset += _v.bytesRead;
        }
        _arr[_i] = _obj;
      }
      result.dependencyResults = _arr;
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.resultSummary = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.resultSummary = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _tag = u8[offset];
      offset += 1;
      if (_tag === 0) {
        result.previousFailure = null;
      } else {
        {
          const _v = _pcDecodeString(u8, offset);
          result.previousFailure = _v.value;
          offset += _v.bytesRead;
        }
      }
    }
    {
      const _len = _pcDecodeVarint(u8, offset);
      offset += _len.bytesRead;
      const _arr: CheckReceipt[] = new Array(_len.value);
      for (let _i = 0; _i < _len.value; _i++) {
        const _obj: CheckReceipt = {} as CheckReceipt;
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.id = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.command = _v.value;
          offset += _v.bytesRead;
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
          _obj.args = _arr;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.workingDirectory = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeZigzagVarint(u8, offset);
          _obj.exitCode = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.stdout = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _v = _pcDecodeString(u8, offset);
          _obj.stderr = _v.value;
          offset += _v.bytesRead;
        }
        {
          _obj.timedOut = u8[offset] === 1;
          offset += 1;
        }
        {
          const _v = _pcDecodeVarint64(u8, offset);
          _obj.durationMs = _v.value;
          offset += _v.bytesRead;
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.outputArtifact = null;
          } else {
            {
              const _v = _pcDecodeString(u8, offset);
              _obj.outputArtifact = _v.value;
              offset += _v.bytesRead;
            }
          }
        }
        {
          const _tag = u8[offset];
          offset += 1;
          if (_tag === 0) {
            _obj.source = null;
          } else {
            {
              const _obj12: SourceReceipt = {} as SourceReceipt;
              {
                const _v = _pcDecodeString(u8, offset);
                _obj12.beforeFingerprint = _v.value;
                offset += _v.bytesRead;
              }
              {
                const _v = _pcDecodeString(u8, offset);
                _obj12.afterFingerprint = _v.value;
                offset += _v.bytesRead;
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
                _obj12.observedChangedPaths = _arr;
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
                _obj12.observedOutsideWriteScope = _arr;
              }
              _obj.source = _obj12;
            }
          }
        }
        _arr[_i] = _obj;
      }
      result.previousChecks = _arr;
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
      result.guidance = _arr;
    }
    return { ok: true, result: result as TaskContextOutput };
  },
};

export const getTraceCodec: FrameCodec<GetTraceInput, GetTraceOutput> = {
  commandId: 24,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: GetTraceInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(GetTraceInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 24, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: GetTraceInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 24; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    return out.subarray(0, w);
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: GetTraceOutput; error?: RustraError } {
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
    const result: Partial<GetTraceOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _obj: TraceSummary = {} as TraceSummary;
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.total_events = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.tasks_created = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.tasks_completed = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.worker_starts = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.worker_finishes = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.worker_failures = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.verification_passes = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.verification_failures = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.attention_created = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.attention_resolved = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _tag = u8[offset];
        offset += 1;
        if (_tag === 0) {
          _obj.elapsed_ms = null;
        } else {
          {
            const _v = _pcDecodeVarint64(u8, offset);
            _obj.elapsed_ms = _v.value;
            offset += _v.bytesRead;
          }
        }
      }
      result.summary = _obj;
    }
    {
      const _obj: TraceScore = {} as TraceScore;
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.reliability = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.autonomy = _v.value;
        offset += _v.bytesRead;
      }
      {
        const _v = _pcDecodeVarint(u8, offset);
        _obj.first_pass = _v.value;
        offset += _v.bytesRead;
      }
      result.score = _obj;
    }
    return { ok: true, result: result as GetTraceOutput };
  },
};

export const listRunsCodec = createSchemaPostcardCodec(43, {"title":"ListRunsInput","type":"object","required":["databasePath"],"properties":{"databasePath":{"type":"string"}}} as ComplexSchema, {"title":"Array_of_RunListOutput","type":"array","items":{"$ref":"#/definitions/RunListOutput"}} as ComplexSchema, {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>, true)! as FrameCodec<ListRunsInput, Array_of_RunListOutput>;

export const pauseRunCodec: FrameCodec<RunInput, OperationOutput> = {
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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

export const prepareGoalRunCodec: FrameCodec<PrepareGoalRunInput, OperationOutput> = {
  commandId: 27,
  execution: "sync",

  encode(args: PrepareGoalRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(PrepareGoalRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 27, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.intent));
    parts.push(_pcEncodeString(args.workingDirectory));
    {
      const _arr = args.tasks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.title));
        {
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.kind);
          if (_idx < 0) throw new Error('invalid enum value for kind: ' + _arr[_i]!.kind);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _arri = _arr[_i]!.dependencies;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.readScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.writeScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.requirements;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.persona;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        {
          const _arri = _arr[_i]!.completionChecks;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.id));
            parts.push(_pcEncodeString(_arri[_ii]!.command));
            {
              const _arrii = _arri[_ii]!.args;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _opt = _arri[_ii]!.workingDirectory;
              if (_opt === null || _opt === undefined) {
                parts.push(new Uint8Array([0]));
              } else {
                parts.push(new Uint8Array([1]));
                parts.push(_pcEncodeString(_opt));
              }
            }
            parts.push(_pcEncodeVarint64(_arri[_ii]!.timeoutMs));
          }
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.preferredCompute);
          if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + _arr[_i]!.preferredCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.minimumCompute);
          if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + _arr[_i]!.minimumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.maximumCompute);
          if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + _arr[_i]!.maximumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _opt = _arr[_i]!.routing;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            {
              const _variants = ["low","medium","high","critical"] as const;
              const _idx = _variants.indexOf(_opt.risk);
              if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
              parts.push(_pcEncodeVarint(_idx));
            }
            parts.push(_pcEncodeVarint(_opt.required.coding));
            parts.push(_pcEncodeVarint(_opt.required.reasoning));
            parts.push(_pcEncodeVarint(_opt.required.tools));
            parts.push(_pcEncodeVarint(_opt.required.vision));
            parts.push(_pcEncodeVarint(_opt.required.long_context));
          }
        }
        parts.push(_pcEncodeVarint(_arr[_i]!.maxAttempts));
      }
    }
    {
      const _arr = args.criteria;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.description));
        parts.push(_pcEncodeString(_arr[_i]!.taskId));
        {
          const _arri = _arr[_i]!.checkIds;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
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

export const prepareRunCodec: FrameCodec<PrepareRunInput, OperationOutput> = {
  commandId: 26,
  execution: "sync",

  encode(args: PrepareRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(PrepareRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 26, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.intent));
    parts.push(_pcEncodeString(args.workingDirectory));
    {
      const _arr = args.tasks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.title));
        {
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.kind);
          if (_idx < 0) throw new Error('invalid enum value for kind: ' + _arr[_i]!.kind);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _arri = _arr[_i]!.dependencies;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.readScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.writeScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.requirements;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.persona;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        {
          const _arri = _arr[_i]!.completionChecks;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.id));
            parts.push(_pcEncodeString(_arri[_ii]!.command));
            {
              const _arrii = _arri[_ii]!.args;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _opt = _arri[_ii]!.workingDirectory;
              if (_opt === null || _opt === undefined) {
                parts.push(new Uint8Array([0]));
              } else {
                parts.push(new Uint8Array([1]));
                parts.push(_pcEncodeString(_opt));
              }
            }
            parts.push(_pcEncodeVarint64(_arri[_ii]!.timeoutMs));
          }
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.preferredCompute);
          if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + _arr[_i]!.preferredCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.minimumCompute);
          if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + _arr[_i]!.minimumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.maximumCompute);
          if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + _arr[_i]!.maximumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _opt = _arr[_i]!.routing;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            {
              const _variants = ["low","medium","high","critical"] as const;
              const _idx = _variants.indexOf(_opt.risk);
              if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
              parts.push(_pcEncodeVarint(_idx));
            }
            parts.push(_pcEncodeVarint(_opt.required.coding));
            parts.push(_pcEncodeVarint(_opt.required.reasoning));
            parts.push(_pcEncodeVarint(_opt.required.tools));
            parts.push(_pcEncodeVarint(_opt.required.vision));
            parts.push(_pcEncodeVarint(_opt.required.long_context));
          }
        }
        parts.push(_pcEncodeVarint(_arr[_i]!.maxAttempts));
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

export const prepareRunPreflightCodec: FrameCodec<PrepareRunPreflightInput, OperationOutput> = {
  commandId: 47,
  execution: "sync",

  encode(args: PrepareRunPreflightInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(PrepareRunPreflightInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 47, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.intent));
    parts.push(_pcEncodeString(args.workingDirectory));
    {
      const _arr = args.tasks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.task.id));
        parts.push(_pcEncodeString(_arr[_i]!.task.title));
        {
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.task.kind);
          if (_idx < 0) throw new Error('invalid enum value for kind: ' + _arr[_i]!.task.kind);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _arri = _arr[_i]!.task.dependencies;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.task.readScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.task.writeScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.task.requirements;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.task.persona;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        {
          const _arri = _arr[_i]!.task.completionChecks;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.id));
            parts.push(_pcEncodeString(_arri[_ii]!.command));
            {
              const _arrii = _arri[_ii]!.args;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _opt = _arri[_ii]!.workingDirectory;
              if (_opt === null || _opt === undefined) {
                parts.push(new Uint8Array([0]));
              } else {
                parts.push(new Uint8Array([1]));
                parts.push(_pcEncodeString(_opt));
              }
            }
            parts.push(_pcEncodeVarint64(_arri[_ii]!.timeoutMs));
          }
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.task.preferredCompute);
          if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + _arr[_i]!.task.preferredCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.task.minimumCompute);
          if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + _arr[_i]!.task.minimumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.task.maximumCompute);
          if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + _arr[_i]!.task.maximumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _opt = _arr[_i]!.task.routing;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            {
              const _variants = ["low","medium","high","critical"] as const;
              const _idx = _variants.indexOf(_opt.risk);
              if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
              parts.push(_pcEncodeVarint(_idx));
            }
            parts.push(_pcEncodeVarint(_opt.required.coding));
            parts.push(_pcEncodeVarint(_opt.required.reasoning));
            parts.push(_pcEncodeVarint(_opt.required.tools));
            parts.push(_pcEncodeVarint(_opt.required.vision));
            parts.push(_pcEncodeVarint(_opt.required.long_context));
          }
        }
        parts.push(_pcEncodeVarint(_arr[_i]!.task.maxAttempts));
        {
          const _arri = _arr[_i]!.defaults;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.assumptions;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.assumption));
            parts.push(_pcEncodeString(_arri[_ii]!.evidence));
            parts.push(_pcEncodeString(_arri[_ii]!.ifFalse));
            parts.push(_pcEncodeString(_arri[_ii]!.revisit));
          }
        }
        {
          const _arri = _arr[_i]!.semanticTouchpoints;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.id));
            {
              const _variants = ["consume","modify"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.access);
              if (_idx < 0) throw new Error('invalid enum value for access: ' + _arri[_ii]!.access);
              parts.push(_pcEncodeVarint(_idx));
            }
            {
              const _variants = ["unresolved","serialize","dependency_order"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.conflictResolution);
              if (_idx < 0) throw new Error('invalid enum value for conflictResolution: ' + _arri[_ii]!.conflictResolution);
              parts.push(_pcEncodeVarint(_idx));
            }
          }
        }
        {
          const _arri = _arr[_i]!.consumes;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.dependency));
            {
              const _arrii = _arri[_ii]!.decisions;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _arrii = _arri[_ii]!.artifacts;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _arrii = _arri[_ii]!.checks;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _arrii = _arri[_ii]!.risks;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
          }
        }
        {
          const _arri = _arr[_i]!.completionCoverage;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.checkId));
            {
              const _arrii = _arri[_ii]!.requirements;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _arrii = _arri[_ii]!.artifacts;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _arrii = _arri[_ii]!.semantics;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _variants = ["static","unit","fake","integration","live"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.evidenceLevel);
              if (_idx < 0) throw new Error('invalid enum value for evidenceLevel: ' + _arri[_ii]!.evidenceLevel);
              parts.push(_pcEncodeVarint(_idx));
            }
          }
        }
        {
          const _arri = _arr[_i]!.failurePolicy.retryBudgets;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            {
              const _variants = ["assertion","timeout","process_start","invalid_contract","interrupted","environment"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.failureClass);
              if (_idx < 0) throw new Error('invalid enum value for failureClass: ' + _arri[_ii]!.failureClass);
              parts.push(_pcEncodeVarint(_idx));
            }
            {
              const _variants = ["check","candidate","worker","compute"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.scope);
              if (_idx < 0) throw new Error('invalid enum value for scope: ' + _arri[_ii]!.scope);
              parts.push(_pcEncodeVarint(_idx));
            }
            parts.push(_pcEncodeVarint(_arri[_ii]!.maxRetries));
            parts.push(_pcEncodeVarint64(_arri[_ii]!.backoff.initialDelayMs));
            parts.push(_pcEncodeVarint(_arri[_ii]!.backoff.multiplier));
            parts.push(_pcEncodeVarint64(_arri[_ii]!.backoff.maxDelayMs));
            {
              const _variants = ["fail_task","require_attention"] as const;
              const _idx = _variants.indexOf(_arri[_ii]!.onExhaustion);
              if (_idx < 0) throw new Error('invalid enum value for onExhaustion: ' + _arri[_ii]!.onExhaustion);
              parts.push(_pcEncodeVarint(_idx));
            }
          }
        }
        {
          const _variants = ["fail_task","require_attention"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.failurePolicy.onUnbudgetedFailure);
          if (_idx < 0) throw new Error('invalid enum value for onUnbudgetedFailure: ' + _arr[_i]!.failurePolicy.onUnbudgetedFailure);
          parts.push(_pcEncodeVarint(_idx));
        }
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

export const promoteSteerCodec: FrameCodec<PromoteSteerInput, PromoteSteerOutput> = {
  commandId: 38,
  execution: "sync",

  encode(args: PromoteSteerInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(PromoteSteerInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 38, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.message));
    parts.push(_pcEncodeString(args.task.id));
    parts.push(_pcEncodeString(args.task.title));
    {
      const _variants = ["research","decision","implementation","verification","integration"] as const;
      const _idx = _variants.indexOf(args.task.kind);
      if (_idx < 0) throw new Error('invalid enum value for kind: ' + args.task.kind);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _arr = args.task.dependencies;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.readScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.writeScope;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _arr = args.task.requirements;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    {
      const _opt = args.task.persona;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    {
      const _arr = args.task.completionChecks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.command));
        {
          const _arri = _arr[_i]!.args;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.workingDirectory;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        parts.push(_pcEncodeVarint64(_arr[_i]!.timeoutMs));
      }
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.preferredCompute);
      if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + args.task.preferredCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.minimumCompute);
      if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.task.minimumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.task.maximumCompute);
      if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.task.maximumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _opt = args.task.routing;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        {
          const _variants = ["low","medium","high","critical"] as const;
          const _idx = _variants.indexOf(_opt.risk);
          if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
          parts.push(_pcEncodeVarint(_idx));
        }
        parts.push(_pcEncodeVarint(_opt.required.coding));
        parts.push(_pcEncodeVarint(_opt.required.reasoning));
        parts.push(_pcEncodeVarint(_opt.required.tools));
        parts.push(_pcEncodeVarint(_opt.required.vision));
        parts.push(_pcEncodeVarint(_opt.required.long_context));
      }
    }
    parts.push(_pcEncodeVarint(args.task.maxAttempts));
    {
      const _arr = args.criteria;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.description));
        parts.push(_pcEncodeString(_arr[_i]!.taskId));
        {
          const _arri = _arr[_i]!.checkIds;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
      }
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: PromoteSteerOutput; error?: RustraError } {
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
    const result: Partial<PromoteSteerOutput> = {};
    {
      result.accepted = u8[offset] === 1;
      offset += 1;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.runId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.taskId = _v.value;
      offset += _v.bytesRead;
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
      result.criterionIds = _arr;
    }
    {
      const _v = _pcDecodeString(u8, offset);
      result.summary = _v.value;
      offset += _v.bytesRead;
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
      result.evidenceTests = _arr;
    }
    return { ok: true, result: result as PromoteSteerOutput };
  },
};

export const reconcileTaskCodec: FrameCodec<ReconcileTaskInput, OperationOutput> = {
  commandId: 42,
  execution: "sync",

  encode(args: ReconcileTaskInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ReconcileTaskInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 42, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(new Uint8Array([args.confirmedStopped ? 1 : 0]));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ReconcileTaskInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 42; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.taskId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { ensure(1); out[w++] = args.confirmedStopped ? 1 : 0; }
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

export const recordActivityCodec: FrameCodec<RecordActivityInput, OperationOutput> = {
  commandId: 35,
  execution: "sync",

  encode(args: RecordActivityInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RecordActivityInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 35, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(_pcEncodeString(args.activity));
    {
      const _opt = args.executionOwner;
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

export const recordCheckReceiptsCodec: FrameCodec<RecordCheckReceiptsInput, OperationOutput> = {
  commandId: 33,
  execution: "sync",

  encode(args: RecordCheckReceiptsInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RecordCheckReceiptsInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 33, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    {
      const _arr = args.checks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.command));
        {
          const _arri = _arr[_i]!.args;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        parts.push(_pcEncodeString(_arr[_i]!.workingDirectory));
        parts.push(_pcEncodeZigzagVarint(_arr[_i]!.exitCode));
        parts.push(_pcEncodeString(_arr[_i]!.stdout));
        parts.push(_pcEncodeString(_arr[_i]!.stderr));
        parts.push(new Uint8Array([_arr[_i]!.timedOut ? 1 : 0]));
        parts.push(_pcEncodeVarint64(_arr[_i]!.durationMs));
        {
          const _opt = _arr[_i]!.outputArtifact;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        {
          const _opt = _arr[_i]!.source;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt.beforeFingerprint));
            parts.push(_pcEncodeString(_opt.afterFingerprint));
            {
              const _arri = _opt.observedChangedPaths;
              parts.push(_pcEncodeVarint(_arri.length));
              for (let _ii = 0; _ii < _arri.length; _ii++) {
                parts.push(_pcEncodeString(_arri[_ii]!));
              }
            }
            {
              const _arri = _opt.observedOutsideWriteScope;
              parts.push(_pcEncodeVarint(_arri.length));
              for (let _ii = 0; _ii < _arri.length; _ii++) {
                parts.push(_pcEncodeString(_arri[_ii]!));
              }
            }
          }
        }
      }
    }
    {
      const _opt = args.executionOwner;
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

export const recordGuidanceDeliveredCodec: FrameCodec<RecordGuidanceDeliveredInput, OperationOutput> = {
  commandId: 48,
  execution: "sync",

  encode(args: RecordGuidanceDeliveredInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RecordGuidanceDeliveredInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 48, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.guidance.taskId));
    parts.push(_pcEncodeString(args.guidance.workerId));
    parts.push(_pcEncodeZigzag64(args.guidance.throughSequence));
    {
      const _opt = args.executionOwner;
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

export const recordTaskOutputCodec: FrameCodec<RecordTaskOutputInput, OperationOutput> = {
  commandId: 36,
  execution: "sync",

  encode(args: RecordTaskOutputInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RecordTaskOutputInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 36, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    parts.push(_pcEncodeString(args.summary));
    {
      const _opt = args.executionOwner;
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
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(new Uint8Array([_arr[_i]!.passed ? 1 : 0]));
      }
    }
    parts.push(_pcEncodeString(args.reason));
    {
      const _opt = args.executionOwner;
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

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const recordWorkerResultComplexCodec: FrameCodec<WorkerResultInput, OperationOutput> = createComplexCodec<WorkerResultInput, OperationOutput>({
  commandId: 8,
  execution: "sync",
  inputSchema: {"title":"WorkerResultInput","type":"object","required":["databasePath","runId","success","summary","taskId","workerId"],"properties":{"databasePath":{"type":"string"},"runId":{"type":"string"},"taskId":{"type":"string"},"workerId":{"type":"string"},"success":{"type":"boolean"},"summary":{"type":"string"},"executionOwner":{"type":["string","null"]},"state":{"anyOf":[{"$ref":"#/definitions/WorkerState"},{"type":"null"}]}}} as ComplexSchema,
  outputSchema: {"title":"OperationOutput","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}}} as ComplexSchema,
  definitions: {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const recordWorkerResultCodec = recordWorkerResultComplexCodec;

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const recordWorkerStartedComplexCodec: FrameCodec<WorkerInput, OperationOutput> = createComplexCodec<WorkerInput, OperationOutput>({
  commandId: 7,
  execution: "sync",
  inputSchema: {"title":"WorkerInput","type":"object","required":["databasePath","runId","taskId","workerId"],"properties":{"databasePath":{"type":"string"},"runId":{"type":"string"},"taskId":{"type":"string"},"workerId":{"type":"string"},"executionOwner":{"type":["string","null"]},"state":{"anyOf":[{"$ref":"#/definitions/WorkerState"},{"type":"null"}]}}} as ComplexSchema,
  outputSchema: {"title":"OperationOutput","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}}} as ComplexSchema,
  definitions: {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const recordWorkerStartedCodec = recordWorkerStartedComplexCodec;

/** route: complex-binary; RN uses native C++ when the schema is native-safe, otherwise JS. */
export const recordWorkerStoppedComplexCodec: FrameCodec<WorkerInput, OperationOutput> = createComplexCodec<WorkerInput, OperationOutput>({
  commandId: 16,
  execution: "sync",
  inputSchema: {"title":"WorkerInput","type":"object","required":["databasePath","runId","taskId","workerId"],"properties":{"databasePath":{"type":"string"},"runId":{"type":"string"},"taskId":{"type":"string"},"workerId":{"type":"string"},"executionOwner":{"type":["string","null"]},"state":{"anyOf":[{"$ref":"#/definitions/WorkerState"},{"type":"null"}]}}} as ComplexSchema,
  outputSchema: {"title":"OperationOutput","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}}} as ComplexSchema,
  definitions: {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>,
});

export const recordWorkerStoppedCodec = recordWorkerStoppedComplexCodec;

export const releaseExecutionCodec: FrameCodec<ReleaseExecutionInput, OperationOutput> = {
  commandId: 41,
  execution: "sync",
  syncFields: ["databasePath","runId","owner"],

  encode(args: ReleaseExecutionInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ReleaseExecutionInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 41, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.owner));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ReleaseExecutionInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 41; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.owner; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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

export const renewExecutionCodec: FrameCodec<ExecutionLeaseInput, OperationOutput> = {
  commandId: 40,
  execution: "sync",

  encode(args: ExecutionLeaseInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(ExecutionLeaseInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 40, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.owner));
    parts.push(_pcEncodeZigzag64(args.nowMs));
    parts.push(_pcEncodeZigzag64(args.ttlMs));
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  encodeInto(args: ExecutionLeaseInput, reuse?: Uint8Array): Uint8Array {
    let out = reuse ?? new Uint8Array(64);
    let w = 0;
    const ensure = (need: number) => {
      if (w + need <= out.length) return;
      const grown = new Uint8Array(Math.max(out.length * 2, w + need));
      grown.set(out.subarray(0, w));
      out = grown;
    };
    ensure(2);
    out[w++] = 40; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.owner; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { let _x = BigInt(args.nowMs); if (_x < _pcI64Min || _x > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + _x.toString()); _x = (_x << 1n) ^ (_x >> 63n); do { ensure(1); out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] = out[w - 1]! & 0x7f; }
    { let _x = BigInt(args.ttlMs); if (_x < _pcI64Min || _x > _pcI64Max) throw new Error('zigzag64 input outside i64 range: ' + _x.toString()); _x = (_x << 1n) ^ (_x >> 63n); do { ensure(1); out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] = out[w - 1]! & 0x7f; }
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
      const _variants = ["question","decision","approval","conflict","failure"] as const;
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
    {
      const _opt = args.executionOwner;
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
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.attentionId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.resolution; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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
  commandId: 17,
  execution: "sync",
  syncFields: ["databasePath","runId"],

  encode(args: RunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(RunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 17, true);
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
    out[w++] = 17; out[w++] = 0;
    { const _s = args.databasePath; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
    { const _s = args.runId; const _u = _utf8Encode(_s); ensure(5 + _u.length); let _v = _u.length; do { out[w++] = (_v % 128) | 0x80; _v = Math.floor(_v / 128); } while (_v > 0); out[w - 1] = out[w - 1]! & 0x7f; out.set(_u, w); w += _u.length; }
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

export const selectCandidateCodec: FrameCodec<SelectCandidateInput, SelectCandidateOutput> = {
  commandId: 44,
  execution: "sync",

  encode(args: SelectCandidateInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(SelectCandidateInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 44, true);
    parts.push(cmdId);
    {
      const _arr = args.candidates;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!.id));
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.computeClass);
          if (_idx < 0) throw new Error('invalid enum value for computeClass: ' + _arr[_i]!.computeClass);
          parts.push(_pcEncodeVarint(_idx));
        }
        parts.push(_pcEncodeVarint(_arr[_i]!.capabilities.coding));
        parts.push(_pcEncodeVarint(_arr[_i]!.capabilities.reasoning));
        parts.push(_pcEncodeVarint(_arr[_i]!.capabilities.tools));
        parts.push(_pcEncodeVarint(_arr[_i]!.capabilities.vision));
        parts.push(_pcEncodeVarint(_arr[_i]!.capabilities.longContext));
        parts.push(_pcEncodeVarint(_arr[_i]!.latency));
        parts.push(_pcEncodeVarint(_arr[_i]!.costWeight));
        parts.push(new Uint8Array([_arr[_i]!.available ? 1 : 0]));
      }
    }
    {
      const _arr = args.eligibleCandidateIds;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(_arr[_i]!));
      }
    }
    parts.push(_pcEncodeVarint(args.requirements.capabilities.coding));
    parts.push(_pcEncodeVarint(args.requirements.capabilities.reasoning));
    parts.push(_pcEncodeVarint(args.requirements.capabilities.tools));
    parts.push(_pcEncodeVarint(args.requirements.capabilities.vision));
    parts.push(_pcEncodeVarint(args.requirements.capabilities.longContext));
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.requirements.minimumCompute);
      if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + args.requirements.minimumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.requirements.maximumCompute);
      if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + args.requirements.maximumCompute);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["low","medium","high","critical"] as const;
      const _idx = _variants.indexOf(args.requirements.risk);
      if (_idx < 0) throw new Error('invalid enum value for risk: ' + args.requirements.risk);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.requirements.highRiskFloor);
      if (_idx < 0) throw new Error('invalid enum value for highRiskFloor: ' + args.requirements.highRiskFloor);
      parts.push(_pcEncodeVarint(_idx));
    }
    {
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      const _idx = _variants.indexOf(args.requirements.criticalRiskFloor);
      if (_idx < 0) throw new Error('invalid enum value for criticalRiskFloor: ' + args.requirements.criticalRiskFloor);
      parts.push(_pcEncodeVarint(_idx));
    }
    return _pcConcatUint8Arrays(parts).buffer as ArrayBuffer;
  },

  decode(buf: ArrayBuffer | ArrayBufferView): { ok: boolean; result?: SelectCandidateOutput; error?: RustraError } {
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
    const result: Partial<SelectCandidateOutput> = {};
    {
      const _v = _pcDecodeString(u8, offset);
      result.candidateId = _v.value;
      offset += _v.bytesRead;
    }
    {
      const _v = _pcDecodeVarint(u8, offset);
      offset += _v.bytesRead;
      const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
      result.computeClass = _variants[_v.value]!;
    }
    return { ok: true, result: result as SelectCandidateOutput };
  },
};

export const steerRunCodec: FrameCodec<SteerRunInput, OperationOutput> = {
  commandId: 37,
  execution: "sync",

  encode(args: SteerRunInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(SteerRunInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 37, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    {
      const _opt = args.taskId;
      if (_opt === null || _opt === undefined) {
        parts.push(new Uint8Array([0]));
      } else {
        parts.push(new Uint8Array([1]));
        parts.push(_pcEncodeString(_opt));
      }
    }
    parts.push(_pcEncodeString(args.message));
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

export const stopVerificationCodec: FrameCodec<StopVerificationInput, OperationOutput> = {
  commandId: 34,
  execution: "sync",

  encode(args: StopVerificationInput): ArrayBuffer {
    // [cmd_id: u16 LE][postcard(StopVerificationInput)]
    const parts: Uint8Array[] = [];
    const cmdId = new Uint8Array(2);
    new DataView(cmdId.buffer).setUint16(0, 34, true);
    parts.push(cmdId);
    parts.push(_pcEncodeString(args.databasePath));
    parts.push(_pcEncodeString(args.runId));
    parts.push(_pcEncodeString(args.taskId));
    {
      const _opt = args.executionOwner;
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
        parts.push(_pcEncodeString(_arr[_i]!.id));
        parts.push(_pcEncodeString(_arr[_i]!.title));
        {
          const _variants = ["research","decision","implementation","verification","integration"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.kind);
          if (_idx < 0) throw new Error('invalid enum value for kind: ' + _arr[_i]!.kind);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _arri = _arr[_i]!.dependencies;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.readScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.writeScope;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _arri = _arr[_i]!.requirements;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!));
          }
        }
        {
          const _opt = _arr[_i]!.persona;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            parts.push(_pcEncodeString(_opt));
          }
        }
        {
          const _arri = _arr[_i]!.completionChecks;
          parts.push(_pcEncodeVarint(_arri.length));
          for (let _ii = 0; _ii < _arri.length; _ii++) {
            parts.push(_pcEncodeString(_arri[_ii]!.id));
            parts.push(_pcEncodeString(_arri[_ii]!.command));
            {
              const _arrii = _arri[_ii]!.args;
              parts.push(_pcEncodeVarint(_arrii.length));
              for (let _iii = 0; _iii < _arrii.length; _iii++) {
                parts.push(_pcEncodeString(_arrii[_iii]!));
              }
            }
            {
              const _opt = _arri[_ii]!.workingDirectory;
              if (_opt === null || _opt === undefined) {
                parts.push(new Uint8Array([0]));
              } else {
                parts.push(new Uint8Array([1]));
                parts.push(_pcEncodeString(_opt));
              }
            }
            parts.push(_pcEncodeVarint64(_arri[_ii]!.timeoutMs));
          }
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.preferredCompute);
          if (_idx < 0) throw new Error('invalid enum value for preferredCompute: ' + _arr[_i]!.preferredCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.minimumCompute);
          if (_idx < 0) throw new Error('invalid enum value for minimumCompute: ' + _arr[_i]!.minimumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _variants = ["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"] as const;
          const _idx = _variants.indexOf(_arr[_i]!.maximumCompute);
          if (_idx < 0) throw new Error('invalid enum value for maximumCompute: ' + _arr[_i]!.maximumCompute);
          parts.push(_pcEncodeVarint(_idx));
        }
        {
          const _opt = _arr[_i]!.routing;
          if (_opt === null || _opt === undefined) {
            parts.push(new Uint8Array([0]));
          } else {
            parts.push(new Uint8Array([1]));
            {
              const _variants = ["low","medium","high","critical"] as const;
              const _idx = _variants.indexOf(_opt.risk);
              if (_idx < 0) throw new Error('invalid enum value for risk: ' + _opt.risk);
              parts.push(_pcEncodeVarint(_idx));
            }
            parts.push(_pcEncodeVarint(_opt.required.coding));
            parts.push(_pcEncodeVarint(_opt.required.reasoning));
            parts.push(_pcEncodeVarint(_opt.required.tools));
            parts.push(_pcEncodeVarint(_opt.required.vision));
            parts.push(_pcEncodeVarint(_opt.required.long_context));
          }
        }
        parts.push(_pcEncodeVarint(_arr[_i]!.maxAttempts));
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

export const subscribeEventsCodec = createSchemaPostcardCodec(20, {"title":"SubscribeEventsInput","type":"object","required":["afterSequence","databasePath","limit","runId"],"properties":{"databasePath":{"type":"string"},"runId":{"type":"string"},"afterSequence":{"type":"integer","format":"int64"},"limit":{"type":"integer","format":"uint16","minimum":0}}} as ComplexSchema, {"title":"Array_of_EventOutput","type":"array","items":{"$ref":"#/definitions/EventOutput"}} as ComplexSchema, {"TaskSpecInput":{"type":"object","required":["completionChecks","dependencies","id","kind","maxAttempts","maximumCompute","minimumCompute","preferredCompute","readScope","requirements","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"requirements":{"type":"array","items":{"type":"string"}},"persona":{"type":["string","null"]},"completionChecks":{"type":"array","items":{"$ref":"#/definitions/CompletionCheckInput"}},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"routing":{"anyOf":[{"$ref":"#/definitions/TaskRouting"},{"type":"null"}]},"maxAttempts":{"type":"integer","format":"uint16","minimum":0}}},"TaskKind":{"type":"string","enum":["research","decision","implementation","verification","integration"]},"CompletionCheckInput":{"type":"object","required":["args","command","id","timeoutMs"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":["string","null"]},"timeoutMs":{"type":"integer","format":"uint64","minimum":0}}},"ComputeClass":{"type":"string","enum":["deterministic","typed_decision","tiny","fast","balanced","strong","frontier"]},"TaskRouting":{"type":"object","required":["required","risk"],"properties":{"risk":{"$ref":"#/definitions/Risk"},"required":{"$ref":"#/definitions/ComputeCapabilities"}}},"Risk":{"type":"string","enum":["low","medium","high","critical"]},"ComputeCapabilities":{"type":"object","required":["coding","long_context","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"long_context":{"type":"integer","format":"uint8","minimum":0}}},"GoalCriterionInput":{"type":"object","required":["checkIds","description","id","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}}}},"SkippedArtifactOutput":{"type":"object","required":["artifact","reason"],"properties":{"artifact":{"type":"string"},"reason":{"type":"string"}}},"TraceReportEntry":{"description":"Per-run row of a benchmark report: aggregated metrics plus derived score.","type":"object","required":["runId","score","summary"],"properties":{"runId":{"type":"string"},"summary":{"$ref":"#/definitions/TraceSummary"},"score":{"$ref":"#/definitions/TraceScore"}}},"TraceSummary":{"description":"Aggregate, deterministic metrics for one run's ordered event sequence.\n\nEvery counter is derived purely from event kinds; `elapsed_ms` is the only wall-clock field and is never invented here — a caller with a clock (such as a store query joining recorded timings) may fill it in.","type":"object","properties":{"total_events":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"tasks_completed":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_starts":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_finishes":{"default":0,"type":"integer","format":"uint32","minimum":0},"worker_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_passes":{"default":0,"type":"integer","format":"uint32","minimum":0},"verification_failures":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_created":{"default":0,"type":"integer","format":"uint32","minimum":0},"attention_resolved":{"default":0,"type":"integer","format":"uint32","minimum":0},"elapsed_ms":{"default":null,"type":["integer","null"],"format":"uint64","minimum":0}}},"TraceScore":{"description":"Deterministic comparison score for a [`TraceSummary`].\n\nEach component is per-mille (0..=1000); `total` is therefore 0..=3000.","type":"object","required":["autonomy","first_pass","reliability"],"properties":{"reliability":{"description":"Completed tasks out of created tasks.","type":"integer","format":"uint16","minimum":0},"autonomy":{"description":"Resolved attention out of created attention; a run that never needed attention scores full marks.","type":"integer","format":"uint16","minimum":0},"first_pass":{"description":"Verification passes out of verification attempts.","type":"integer","format":"uint16","minimum":0}}},"TraceComparison":{"type":"object","required":["rankings"],"properties":{"rankings":{"type":"array","items":{"$ref":"#/definitions/TraceRanking"}}}},"TraceRanking":{"type":"object","required":["label","score"],"properties":{"label":{"type":"string"},"score":{"$ref":"#/definitions/TraceScore"}}},"RunState":{"type":"string","enum":["active","pausing","paused","cancelling","attention","completed","failed","cancelled"]},"TaskSnapshotOutput":{"type":"object","required":["activities","attempt","blockedBy","dependencies","id","kind","preferredCompute","readScope","state","title","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"attempt":{"type":"integer","format":"uint16","minimum":0},"preferredCompute":{"$ref":"#/definitions/ComputeClass"},"dependencies":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"lastFailure":{"type":["string","null"]},"activities":{"type":"array","items":{"type":"string"}},"lastProgressMs":{"type":["integer","null"],"format":"int64"},"resultSummary":{"type":["string","null"]}}},"TaskState":{"type":"string","enum":["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"]},"ActiveWorkerOutput":{"type":"object","required":["id","taskId"],"properties":{"id":{"type":"string"},"taskId":{"type":"string"}}},"AttentionSnapshotOutput":{"type":"object","required":["id","kind","summary"],"properties":{"openedAtMs":{"type":["integer","null"],"format":"int64"},"id":{"type":"string"},"kind":{"$ref":"#/definitions/AttentionKind"},"summary":{"type":"string"},"taskId":{"type":["string","null"]}}},"AttentionKind":{"type":"string","enum":["question","decision","approval","conflict","failure"]},"GoalCriterionStatusOutput":{"type":"object","required":["checkIds","description","id","state","taskId"],"properties":{"id":{"type":"string"},"description":{"type":"string"},"taskId":{"type":"string"},"checkIds":{"type":"array","items":{"type":"string"}},"state":{"$ref":"#/definitions/GoalCriterionState"}}},"GoalCriterionState":{"type":"string","enum":["pending","verified"]},"RefusalCode":{"type":"string","enum":["run_not_terminal","worktree_unmerged","worktree_dirty","path_is_project_root","path_outside_project","surface_not_owned","external_session"]},"CleanupDisposition":{"oneOf":[{"description":"Retry cleanup only after the run reaches a terminal state.","type":"string","enum":["defer"]},{"description":"Preserve the artifact and record why Loop did not remove it.","type":"string","enum":["skip"]},{"description":"A lossy cleanup choice requires an explicit human decision.","type":"string","enum":["require_decision"]}],"x-rustra-variant-order":["defer","skip","require_decision"]},"FailureClass":{"description":"Infrastructure-neutral classification of an execution or verification failure.","type":"string","enum":["assertion","timeout","process_start","invalid_contract","interrupted","environment"]},"FailurePolicy":{"description":"Deterministic retry decision table. Missing classes fail closed, and deterministic failure classes fail closed even when a budget exists: retry is only ever granted for nondeterministic verification failures ([`FailureClass::is_nondeterministic`]). The deterministic terminal policy — first assertion (or invalid-contract, process-start) failure is terminal — holds regardless of configuration.","type":"object","required":["onUnbudgetedFailure","retryBudgets"],"properties":{"retryBudgets":{"type":"array","items":{"$ref":"#/definitions/RetryBudget"}},"onUnbudgetedFailure":{"$ref":"#/definitions/OnExhaustion"}}},"RetryBudget":{"description":"Retry budget for one failure class. `max_retries` excludes the initial try.","type":"object","required":["backoff","failureClass","maxRetries","onExhaustion","scope"],"properties":{"failureClass":{"$ref":"#/definitions/FailureClass"},"scope":{"$ref":"#/definitions/RetryScope"},"maxRetries":{"type":"integer","format":"uint16","minimum":0},"backoff":{"$ref":"#/definitions/BackoffPolicy"},"onExhaustion":{"$ref":"#/definitions/OnExhaustion"}}},"RetryScope":{"description":"The smallest operation a retry budget permits the executor to repeat.","type":"string","enum":["check","candidate","worker","compute"]},"BackoffPolicy":{"description":"Bounded exponential backoff. A multiplier of one represents fixed backoff.","type":"object","required":["initialDelayMs","maxDelayMs","multiplier"],"properties":{"initialDelayMs":{"type":"integer","format":"uint64","minimum":0},"multiplier":{"type":"integer","format":"uint16","minimum":0},"maxDelayMs":{"type":"integer","format":"uint64","minimum":0}}},"OnExhaustion":{"description":"What the executor must do when no retry remains.","type":"string","enum":["fail_task","require_attention"]},"TerminalizationPolicy":{"description":"Failure propagation rules owned by core rather than an executor adapter.","type":"object","required":["dependents","failRunForSerialTask","independentBranches"],"properties":{"dependents":{"$ref":"#/definitions/DependencyTerminalization"},"independentBranches":{"$ref":"#/definitions/IndependentBranchAction"},"failRunForSerialTask":{"type":"boolean"}}},"DependencyTerminalization":{"description":"Terminal state assigned to descendants that require a failed task.","type":"string","enum":["block_terminal","cancel"]},"IndependentBranchAction":{"type":"string","enum":["continue"]},"FailurePolicyAction":{"type":"string","enum":["retry","failTask","requireAttention"]},"RunFailureAction":{"type":"string","enum":["continue","fail"]},"GraphOwnerHealth":{"type":"string","enum":["live","missing","expired","inactive"]},"GraphNodeOutput":{"type":"object","required":["attempt","blockedBy","dependencies","id","kind","readScope","state","title","workers","writeScope"],"properties":{"id":{"type":"string"},"title":{"type":"string"},"kind":{"$ref":"#/definitions/TaskKind"},"state":{"$ref":"#/definitions/TaskState"},"dependencies":{"type":"array","items":{"type":"string"}},"blockedBy":{"type":"array","items":{"type":"string"}},"readScope":{"type":"array","items":{"type":"string"}},"writeScope":{"type":"array","items":{"type":"string"}},"workers":{"type":"array","items":{"type":"string"}},"attempt":{"type":"integer","format":"uint16","minimum":0},"resultSummary":{"type":["string","null"]},"lastFailure":{"type":["string","null"]}}},"DecompositionContractOutput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints"],"properties":{"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"AssumptionInput":{"type":"object","required":["assumption","evidence","ifFalse","revisit"],"properties":{"assumption":{"type":"string"},"evidence":{"type":"string"},"ifFalse":{"type":"string"},"revisit":{"type":"string"}}},"SemanticTouchpointInput":{"type":"object","required":["access","conflictResolution","id"],"properties":{"id":{"type":"string"},"access":{"$ref":"#/definitions/SemanticAccess"},"conflictResolution":{"$ref":"#/definitions/SemanticConflictResolution"}}},"SemanticAccess":{"type":"string","enum":["consume","modify"]},"SemanticConflictResolution":{"type":"string","enum":["unresolved","serialize","dependency_order"]},"DependencyConsumptionInput":{"type":"object","required":["artifacts","checks","decisions","dependency","risks"],"properties":{"dependency":{"type":"string"},"decisions":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"checks":{"type":"array","items":{"type":"string"}},"risks":{"type":"array","items":{"type":"string"}}}},"CompletionCoverageInput":{"type":"object","required":["artifacts","checkId","evidenceLevel","requirements","semantics"],"properties":{"checkId":{"type":"string"},"requirements":{"type":"array","items":{"type":"string"}},"artifacts":{"type":"array","items":{"type":"string"}},"semantics":{"type":"array","items":{"type":"string"}},"evidenceLevel":{"$ref":"#/definitions/EvidenceLevel"}}},"EvidenceLevel":{"type":"string","enum":["static","unit","fake","integration","live"]},"DependencyResultOutput":{"type":"object","required":["summary","taskId","title"],"properties":{"taskId":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"}}},"CheckReceipt":{"type":"object","required":["args","command","durationMs","exitCode","id","stderr","stdout","timedOut","workingDirectory"],"properties":{"id":{"type":"string"},"command":{"type":"string"},"args":{"type":"array","items":{"type":"string"}},"workingDirectory":{"type":"string"},"exitCode":{"type":"integer","format":"int32"},"stdout":{"type":"string"},"stderr":{"type":"string"},"timedOut":{"type":"boolean"},"durationMs":{"type":"integer","format":"uint64","minimum":0},"outputArtifact":{"default":null,"type":["string","null"]},"source":{"default":null,"anyOf":[{"$ref":"#/definitions/SourceReceipt"},{"type":"null"}]}}},"SourceReceipt":{"type":"object","required":["afterFingerprint","beforeFingerprint","observedChangedPaths","observedOutsideWriteScope"],"properties":{"beforeFingerprint":{"description":"Digest of the declared read/write scope around the completion check batch.","type":"string"},"afterFingerprint":{"type":"string"},"observedChangedPaths":{"description":"Repository paths observed to change while a worker ran. Shared-tree observations cannot establish which actor wrote them.","type":"array","items":{"type":"string"}},"observedOutsideWriteScope":{"type":"array","items":{"type":"string"}}}},"RunListOutput":{"type":"object","required":["runId","state"],"properties":{"runId":{"type":"string"},"state":{"$ref":"#/definitions/RunState"}}},"PreflightTaskSpecInput":{"type":"object","required":["assumptions","completionCoverage","consumes","defaults","failurePolicy","semanticTouchpoints","task"],"properties":{"task":{"$ref":"#/definitions/TaskSpecInput"},"defaults":{"type":"array","items":{"type":"string"}},"assumptions":{"type":"array","items":{"$ref":"#/definitions/AssumptionInput"}},"semanticTouchpoints":{"type":"array","items":{"$ref":"#/definitions/SemanticTouchpointInput"}},"consumes":{"type":"array","items":{"$ref":"#/definitions/DependencyConsumptionInput"}},"completionCoverage":{"type":"array","items":{"$ref":"#/definitions/CompletionCoverageInput"}},"failurePolicy":{"$ref":"#/definitions/FailurePolicy"}}},"GuidanceDeliveredEvent":{"description":"Wire shape of a steer-mailbox delivery record (ADR M-TL2): the mailbox appends one of these per live worker after a successful `provider.steer`, marking every `GuidanceAdded` at or below `through_sequence` as received by that worker's task. The delivery watermark projection lives in loop-core; this type is only the transport form (see `record_guidance_delivered`).","type":"object","required":["taskId","throughSequence","workerId"],"properties":{"taskId":{"type":"string"},"workerId":{"type":"string"},"throughSequence":{"type":"integer","format":"int64"}}},"CheckResultInput":{"type":"object","required":["id","passed"],"properties":{"id":{"type":"string"},"passed":{"type":"boolean"}}},"WorkerState":{"description":"Lifecycle vocabulary for a worker as observed at the adapter boundary.\n\nThis enum is the domain source of the worker-status vocabulary. The bridge carries this type through the optional `state` fields on `WorkerInput` and `WorkerResultInput`, generating the protocol `WorkerState`. These observations do not change the existing worker result policy; absent state remains valid for callers that only report success and summary. Adapters should consume the generated type rather than maintain a copy.\n\nVocabulary correspondence (decided here, once):\n\n- `starting` / `running` / `completed` / `cancelled` map one-to-one to the adapter session lifecycle. - `lost` is the only terminal-without-result state. An adapter session that ends without a usable result (process exit, API failure, blocked or unobservable agent) reports `lost`; the failure taxonomy and retryability stay adapter-side in the worker result. Recovery uses the same term for a worker that can no longer be observed after a restart.\n\nThere is deliberately no `failed` variant: the graph does not distinguish \"worker failed\" from \"worker lost\" as a state — both reconcile through the recorded worker result, and the run-level failure vocabulary already lives in [`crate::run::RunState`] and task events.","type":"string","enum":["starting","running","completed","lost","cancelled"]},"ComputeCandidateInput":{"type":"object","required":["available","capabilities","computeClass","costWeight","id","latency"],"properties":{"id":{"type":"string"},"computeClass":{"$ref":"#/definitions/ComputeClass"},"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"latency":{"type":"integer","format":"uint16","minimum":0},"costWeight":{"type":"integer","format":"uint16","minimum":0},"available":{"type":"boolean"}}},"ComputeCapabilitiesInput":{"description":"Capability scores advertised for a compute candidate (loop-core `ComputeCapabilities` mirror; the core type lacks a JSON schema derive, so the bridge carries its own wire form and converts on entry).","type":"object","required":["coding","longContext","reasoning","tools","vision"],"properties":{"coding":{"type":"integer","format":"uint8","minimum":0},"reasoning":{"type":"integer","format":"uint8","minimum":0},"tools":{"type":"integer","format":"uint8","minimum":0},"vision":{"type":"integer","format":"uint8","minimum":0},"longContext":{"type":"integer","format":"uint8","minimum":0}}},"CapabilityRequirementsInput":{"type":"object","required":["capabilities","criticalRiskFloor","highRiskFloor","maximumCompute","minimumCompute","risk"],"properties":{"capabilities":{"$ref":"#/definitions/ComputeCapabilitiesInput"},"minimumCompute":{"$ref":"#/definitions/ComputeClass"},"maximumCompute":{"$ref":"#/definitions/ComputeClass"},"risk":{"$ref":"#/definitions/RoutingRisk"},"highRiskFloor":{"$ref":"#/definitions/ComputeClass"},"criticalRiskFloor":{"$ref":"#/definitions/ComputeClass"}}},"RoutingRisk":{"description":"Task risk driving the compute-class floor (loop-core `Risk` mirror).","type":"string","enum":["low","medium","high","critical"]},"EventOutput":{"type":"object","required":["payloadJson","sequence"],"properties":{"sequence":{"type":"integer","format":"int64"},"payloadJson":{"type":"string"}}}} as Record<string, ComplexSchema>, true)! as FrameCodec<SubscribeEventsInput, Array_of_EventOutput>;

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
      const _variants = ["pending","ready","running","verifying","attention","blocked","done","failed","cancelled"] as const;
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
