/**
 * Showcase launch-config parsing tests (task `simulator-showcase`):
 * env-mapped initialProps parse into typed fields; absent/malformed values
 * leave the config untouched. Plain values — no RN runtime, no network,
 * no paid model calls.
 */

import { describe, expect, test } from "bun:test";

import { showcaseFromProps } from "../src/showcase";

describe("showcaseFromProps", () => {
  test("absent props → undefined", () => {
    expect(showcaseFromProps(undefined)).toBeUndefined();
    expect(showcaseFromProps({})).toBeUndefined();
    expect(showcaseFromProps({ showcase: null })).toBeUndefined();
  });

  test("parses connect/submit fields", () => {
    const config = showcaseFromProps({
      showcase: {
        bearer: "t",
        host: "h",
        port: "1",
        prompt: "p",
        autoConnect: true,
        autoSubmit: true,
        submitDelayMs: 12000,
        autoLogout: true,
        autoLogoutDelayMs: 3000,
      },
    });
    expect(config).toEqual({
      bearer: "t",
      host: "h",
      port: "1",
      prompt: "p",
      autoConnect: true,
      autoSubmit: true,
      submitDelayMs: 12000,
      autoLogout: true,
      autoLogoutDelayMs: 3000,
    });
  });

  test("parses auto-open-pane fields (terminal mirror demo)", () => {
    const config = showcaseFromProps({
      showcase: { autoOpenPaneId: "w53:p2N", autoOpenPaneDelayMs: 9000 },
    });
    expect(config).toEqual({ autoOpenPaneId: "w53:p2N", autoOpenPaneDelayMs: 9000 });
  });

  test("parses mid-run auto-steer fields (v4 conversation demo)", () => {
    const config = showcaseFromProps({
      showcase: { autoSteerText: "s", autoSteerDelayMs: 7000 },
    });
    expect(config).toEqual({ autoSteerText: "s", autoSteerDelayMs: 7000 });
  });

  test("parses auto-open-run field (v4 conversation demo)", () => {
    const config = showcaseFromProps({ showcase: { autoOpenRunId: "run_x" } });
    expect(config).toEqual({ autoOpenRunId: "run_x" });
  });

  test("parses direct session open + scripted scroll-up fields (v8 demos)", () => {
    const config = showcaseFromProps({
      showcase: { autoOpenSessionId: "sess_demo_orphan_0003", autoScrollUpDelayMs: 6000 },
    });
    expect(config).toEqual({
      autoOpenSessionId: "sess_demo_orphan_0003",
      autoScrollUpDelayMs: 6000,
    });
  });

  test("parses composer draft + scripted attach/send fields (v9 attach demo)", () => {
    const config = showcaseFromProps({
      showcase: {
        composerDraft: "이 스샷의 간격 문제를 찾아줘",
        attachAssetIds: ["att_demo_capture_0001", "att_demo_capture_0002"],
        attachDelayMs: 3000,
        attachSendDelayMs: 8000,
      },
    });
    expect(config).toEqual({
      composerDraft: "이 스샷의 간격 문제를 찾아줘",
      attachAssetIds: ["att_demo_capture_0001", "att_demo_capture_0002"],
      attachDelayMs: 3000,
      attachSendDelayMs: 8000,
    });
  });

  test("drops malformed attach fields (v9 attach demo)", () => {
    const config = showcaseFromProps({
      showcase: {
        attachAssetIds: ["keep", "", 42, null],
        attachDelayMs: -1,
        attachSendDelayMs: Number.NaN,
      },
    });
    expect(config).toEqual({ attachAssetIds: ["keep"] });
  });

  test("ignores malformed values", () => {
    const config = showcaseFromProps({
      showcase: {
        bearer: "",
        autoOpenPaneId: "",
        autoOpenPaneDelayMs: -1,
        submitDelayMs: Number.NaN,
        autoSteerText: "",
        autoSteerDelayMs: Number.NaN,
        autoOpenSessionId: "",
        autoScrollUpDelayMs: -1,
      },
    });
    expect(config).toEqual({});
  });
});
