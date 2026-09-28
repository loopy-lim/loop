import { expect, test } from "bun:test";
import { redact } from "../src/redact";
test("persisted evidence hides full authorization headers and token assignments", () => {
  for (const value of ["Authorization: Basic secret-value", "authorization=Bearer secret-value", '"authorization": "Basic secret-value"', "api_key=secret-value"]) {
    expect(redact(value)).not.toContain("secret-value");
  }
});
test("persisted evidence hides a configured API key even when printed without a label", () => {
  const previous = process.env.LOOP_TEST_API_KEY;
  try {
    process.env.LOOP_TEST_API_KEY = "private-test-credential-value";
    expect(redact("response: private-test-credential-value")).not.toContain("private-test-credential-value");
  } finally {
    if (previous === undefined) delete process.env.LOOP_TEST_API_KEY;
    else process.env.LOOP_TEST_API_KEY = previous;
  }
});
