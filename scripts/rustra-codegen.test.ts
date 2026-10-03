import { expect, test } from "bun:test";

import { normalizeRustraFrameCodecs } from "./rustra-codegen";

test("normalization preserves string enum literal types", () => {
  const source = `
const _variants = ["fast","strong"];
result.kind = _variants[_v.value];
const _variants = ["fast","strong"];
const _idx = _variants.indexOf(args.kind);
`;

  expect(normalizeRustraFrameCodecs(source)).toBe(`
const _variants = ["fast","strong"] as const;
result.kind = _variants[_v.value]!;
const _variants = ["fast","strong"] as const;
const _idx = _variants.indexOf(args.kind);
`);
});

test("normalization gives nested generated collections distinct bindings", () => {
  const source = `
{
  const _arr = args.tasks;
  parts.push(_pcEncodeVarint(_arr.length));
  for (let _i = 0; _i < _arr.length; _i++) {
    {
      const _arr = args.tasks[_i].completionChecks;
      parts.push(_pcEncodeVarint(_arr.length));
      for (let _i = 0; _i < _arr.length; _i++) {
        parts.push(_pcEncodeString(args.tasks[_i].completionChecks[_i].id));
        {
          const _arr = args.tasks[_i].completionChecks[_i].args;
          parts.push(_pcEncodeVarint(_arr.length));
          for (let _i = 0; _i < _arr.length; _i++) {
            parts.push(_pcEncodeString(_arr[_i]));
          }
        }
      }
    }
  }
}
`;

  const normalized = normalizeRustraFrameCodecs(source);
  expect(normalized).toContain("const _arri = _arr[_i]!.completionChecks;");
  expect(normalized).toContain("for (let _ii = 0; _ii < _arri.length; _ii++) {");
  expect(normalized).toContain("_pcEncodeString(_arri[_ii]!.id)");
  expect(normalized).toContain("const _arrii = _arri[_ii]!.args;");
  expect(normalized).toContain("for (let _iii = 0; _iii < _arrii.length; _iii++) {");
  expect(normalized).toContain("_pcEncodeString(_arrii[_iii]!)");
  expect(normalized).not.toContain("completionChecks[_i]");
});

test("normalization is idempotent", () => {
  const source = `const _variants = ["fast","strong"];
result.kind = _variants[_v.value];
`;
  const normalized = normalizeRustraFrameCodecs(source);

  expect(normalizeRustraFrameCodecs(normalized)).toBe(normalized);
});

test("normalization guards bounded indexed reads without changing writes", () => {
  const source = `
{ let _x = BigInt(args.nowMs); do { out[w++] = Number(_x & 0x7fn) | 0x80; _x >>= 7n; } while (_x !== 0n); out[w - 1] &= 0x7f; }
const b = bytes[i];
if (b === undefined) throw new Error('varint out of bounds');
value += (bytes[i + 1] & 0x3f) * 1;
parts.push(_pcEncodeString(_arr[_i].id));
const _arr: string[] = new Array(3);
for (let _i = 0; _i < 3; _i++) {
  _arr[_i] = "x";
}
_obj.kind = _variants[_v.value];
`;

  const normalized = normalizeRustraFrameCodecs(source);
  expect(normalized).toContain("out[w - 1] = out[w - 1]! & 0x7f;");
  expect(normalized).toContain("const b = bytes[i]!;");
  expect(normalized).toContain("bytes[i + 1]!");
  expect(normalized).toContain("_pcEncodeString(_arr[_i]!.id)");
  expect(normalized).toContain("_arr[_i] = \"x\";");
  expect(normalized).toContain("_variants[_v.value]!");
  expect(normalizeRustraFrameCodecs(normalized)).toBe(normalized);
});
