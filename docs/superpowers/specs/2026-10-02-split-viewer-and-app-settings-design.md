# Split-Pane Viewer, App Settings, and Run-Resilience Design

Date: 2026-10-02
Status: Approved in Lead conversation (user confirmed tablet split + phone bottom sheet + both mobile and TUI surfaces)

## Goal

1. View files and reports side by side while a Loop run progresses, on both app surfaces, keeping the implementation lightweight (no WebView, no new dependencies, lazy loading, no polling).
2. Add minimal settings to the Loop mobile app.
3. Reduce mid-run stalls: the orchestrator should self-heal criterion verification instead of raising blocking attention whenever possible.

## A. Gateway file API (foundation)

- `GET /v1/files?dir=<relative>` — list files under the Loop working directory (name, size, isDir, mtime).
- `GET /v1/files/content?path=<relative>` — text content only.
- Constraints: reject absolute paths and `..` traversal; confine to the working directory; 512 KB response cap; ETag caching; no new dependencies. Existing gateway auth applies.

## B. Loop mobile app

- Wide screens (tablet / landscape): persistent two-pane layout — left run·task tree (reuses RunScreen data), right viewer for `docs/findings`, `docs/diagnosis`, check receipts.
- Narrow screens (phone): viewer opens as a bottom sheet (drag up from item tap), two snap points (half, full), drag down to dismiss.
- Both layouts share one viewer component; only the container is responsive. Native `Text` + virtualized lists; lightweight markdown rendering as styled text.
- Settings screen (minimal): gateway connection, viewer font size, refresh interval. Stored locally.

## C. Pi TUI (packages/pi-loop)

- Lead command `/files` opens a `ctx.ui.custom()` overlay: `HStack` left file list, right `ScrollView` + `Markdown` viewer.
- Keys: up/down select, Enter open, Esc close. Split only when terminal width is sufficient; otherwise list→view toggle.
- Reads the local file system directly (extension and repo share a machine); lazy load; no polling.

## D. Run resilience (orchestrator)

- Before raising a blocked-goal failure attention, automatically re-run the pending criteria's declared checks once on stable source.
- Raise attention only if criteria remain unverified after that single self-heal pass.
- No new provider concepts in the orchestrator; deterministic policy stays in Rust.

## Verification

- Gateway: unit tests for traversal/size/auth rejection.
- Mobile: component tests for split layout, bottom sheet snaps, settings persistence.
- TUI: component tests for list/view toggle, width threshold, key handling.
- Orchestrator: test that pending criteria checks are re-run before attention.
- Whole repo: `bun run check`.
