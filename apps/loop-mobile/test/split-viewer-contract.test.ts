/**
 * Split-viewer + settings surface contract (split-viewer design §B), pinned
 * by source inspection (react-native does not load under the test runtime,
 * same rule as every other suite here):
 *
 * 1. ONE shared viewer component — both containers render FileViewerPane;
 *    only the container is responsive.
 * 2. Wide = persistent two-pane (tree left, viewer right); narrow = the
 *    same viewer in a bottom sheet with the pure snap policy.
 * 3. Lightweight viewer: native lists + the closed-grammar markdown
 *    parser, lazy /v1/files loads — no WebView, no polling, no new deps.
 * 4. Settings screen: gateway connection, viewer font size, refresh
 *    interval; stored locally through the settings store.
 */

import { describe, expect, test } from "bun:test";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = join(import.meta.dir, "..");
const read = (relative: string): string => readFileSync(join(mobileRoot, relative), "utf8");

const splitScreen = read("src/screens/RunSplitScreen.tsx");
const viewer = read("src/features/file-viewer.tsx");
const viewerModel = read("src/features/file-viewer-model.ts");
const viewerSheet = read("src/features/viewer-sheet.tsx");
const sheetPolicy = read("src/features/bottom-sheet.ts");
const layoutPolicy = read("src/features/split-layout.ts");
const settingsScreen = read("src/screens/SettingsScreen.tsx");
const settingsStore = read("src/state/settings.ts");
const appSource = read("src/App.tsx");
const clientSource = read("src/gateway-client/client.ts");

describe("one shared viewer component (§B)", () => {
  test("both containers render the same FileViewerPane", () => {
    const paneUses = (splitScreen.match(/<FileViewerPane/g) ?? []).length;
    expect(paneUses).toBe(2); // wide dock + narrow sheet
    expect(splitScreen).toContain("resolveSplitLayout(dims.width)");
    expect(splitScreen).toContain('layout === "wide"');
  });

  test("the wide branch is the persistent two-pane layout", () => {
    expect(splitScreen).toContain('flexDirection: "row"');
    // left tree reuses RunScreen data
    expect(splitScreen).toContain("<RunScreen");
    expect(splitScreen).toContain("divider");
  });

  test("the viewer renders the §B seeded targets, tree, and content places", () => {
    expect(viewer).toContain("VIEWER_TARGETS");
    expect(viewer).toContain('place.kind === "targets"');
    expect(viewer).toContain('place.kind === "dir"');
    expect(viewer).toContain("place.isMarkdown");
  });
});

describe("narrow container — bottom sheet (§B)", () => {
  test("the narrow branch opens the viewer in ViewerBottomSheet", () => {
    expect(splitScreen).toContain("<ViewerBottomSheet");
    expect(splitScreen).toContain("setSheetOpen(true)");
  });

  test("the sheet has half and full snap points and drag-to-dismiss", () => {
    expect(sheetPolicy).toContain("SHEET_SNAPS = { half: 0.5, full: 0.92 }");
    expect(sheetPolicy).toContain('"dismiss"');
    expect(viewerSheet).toContain("resolveSheetSnap");
    expect(viewerSheet).toContain("onPanResponderMove");
  });

  test("the sheet adds no motion mechanism outside ui/motion.tsx (AC-S6-2)", () => {
    expect(viewerSheet).not.toMatch(
      /import\s*\{[^}]*\bAnimated\b[^}]*\}\s*from\s*["']react-native["']/,
    );
  });

  test("snap decisions live in the pure policy, not the component", () => {
    expect(viewerSheet).toContain('from "./bottom-sheet"');
  });
});

describe("lightweight viewer rules (§B)", () => {
  test("no WebView anywhere in the app source", () => {
    for (const file of globSync(join(mobileRoot, "src/**/*.@(ts|tsx)"))) {
      expect(readFileSync(file, "utf8")).not.toContain("WebView");
    }
  });

  test("native virtualized lists + styled-text markdown, no new markdown deps", () => {
    expect(viewer).toContain("FlatList");
    expect(viewer).toContain("ScrollView");
    expect(viewer).toContain('from "./markdown"');
    // the dependency set did not grow for the viewer
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies)).not.toContain("react-native-webview");
    expect(Object.keys(pkg.dependencies)).not.toContain("react-native-markdown-display");
  });

  test("lazy load only: the viewer never polls", () => {
    expect(viewer).not.toContain("setInterval");
    expect(viewerModel).not.toContain("setInterval");
    // content rides the gateway file surface via the port
    expect(viewerModel).toContain("api.content(");
    expect(clientSource).toContain('"/files/content"');
    expect(clientSource).toContain('"/files"');
  });

  test("viewer internals stay pure — no react-native in the model/policies", () => {
    for (const [name, source] of [
      ["file-viewer-model", viewerModel],
      ["bottom-sheet", sheetPolicy],
      ["split-layout", layoutPolicy],
      ["settings store", settingsStore],
    ] as const) {
      expect(source, name).not.toContain('from "react-native"');
    }
  });
});

describe("settings screen (§B)", () => {
  test("exactly the three minimal sections", () => {
    expect(settingsScreen).toContain("Gateway connection");
    expect(settingsScreen).toContain("Viewer font size");
    expect(settingsScreen).toContain("Refresh interval");
  });

  test("gateway connection is display-only (sign-in owns the connection)", () => {
    expect(settingsScreen).toContain("Managed at sign-in");
  });

  test("values persist locally through the settings store", () => {
    expect(settingsScreen).toContain("onSave(draft)");
    expect(settingsStore).toContain("createSettingsStore");
    expect(appSource).toContain("settingsKeychainStorage");
    expect(appSource).toContain("<SettingsScreen");
  });

  test("settings feed the split viewer (font size + refresh interval)", () => {
    expect(appSource).toContain("viewerFontSize={settings.viewerFontSize}");
    expect(appSource).toContain("refreshIntervalMs={settings.refreshIntervalMs}");
    expect(splitScreen).toContain("viewerFontSize={props.viewerFontSize}");
  });
});

describe("app wiring (§B entry points)", () => {
  test("the chats footer opens the split viewer and the settings screen", () => {
    expect(appSource).toContain('label="Files & reports"');
    expect(appSource).toContain('label="Settings"');
    expect(appSource).toContain("<RunSplitScreen");
  });

  test("the split viewer keeps the last run's tree across a chats detour", () => {
    expect(appSource).toContain("runId={chat?.runId ?? lastRunId}");
  });
});
