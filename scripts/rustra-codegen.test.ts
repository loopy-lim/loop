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
result.kind = _variants[_v.value];
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
  expect(normalized).toContain("const _arri = _arr[_i].completionChecks;");
  expect(normalized).toContain("for (let _ii = 0; _ii < _arri.length; _ii++) {");
  expect(normalized).toContain("_pcEncodeString(_arri[_ii].id)");
  expect(normalized).toContain("const _arrii = _arri[_ii].args;");
  expect(normalized).toContain("for (let _iii = 0; _iii < _arrii.length; _iii++) {");
  expect(normalized).toContain("_pcEncodeString(_arrii[_iii])");
  expect(normalized).not.toContain("completionChecks[_i]");
});

test("normalization is idempotent", () => {
  const source = `const _variants = ["fast","strong"];
result.kind = _variants[_v.value];
`;
  const normalized = normalizeRustraFrameCodecs(source);

  expect(normalizeRustraFrameCodecs(normalized)).toBe(normalized);
});
