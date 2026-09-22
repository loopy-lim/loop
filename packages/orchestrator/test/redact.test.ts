import { expect, test } from "bun:test";
import { redact } from "../src/redact";
test("persisted evidence hides full authorization headers and token assignments", () => {
  for (const value of ["Authorization: Basic secret-value", "authorization=Bearer secret-value", '"authorization": "Basic secret-value"', "api_key=secret-value"]) {
    expect(redact(value)).not.toContain("secret-value");
  }
});
