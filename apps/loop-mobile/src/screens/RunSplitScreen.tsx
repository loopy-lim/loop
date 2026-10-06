/**
 * Run split screen (split-viewer design §B): the responsive CONTAINER of
 * the one shared viewer. Wide (tablet / landscape, width ≥ §B breakpoint):
 * a persistent two-pane layout — left the run·task tree (RunScreen's
 * projection, unchanged), right the FileViewerPane for docs/findings,
 * docs/diagnosis, and check receipts. Narrow (phone): the same tree full
 * width and the SAME viewer component in a bottom sheet (half/full snaps,
 * drag to dismiss) opened from the files pill.
 *
 * Only the container is responsive (§B): both branches render the same
 * viewer component with the same gateway file API.
 */
import { useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, useWindowDimensions, View } from "react-native";

import type { GatewayClient } from "../gateway-client/client";
import type { FileApi } from "../features/file-viewer-model";
import { FileViewerPane } from "../features/file-viewer";
import { ViewerBottomSheet } from "../features/viewer-sheet";
import { resolveSplitLayout } from "../features/split-layout";
import { RunScreen } from "./RunScreen";
import { DynText } from "../ui/DynText";
import { colors, press, radius, space, type } from "../ui/tokens";

/** GatewayClient → FileApi adapter: the viewer knows the port, the client
 * knows the wire. No other glue exists. */
export function createGatewayFileApi(client: GatewayClient): FileApi {
  return {
    list: (dir) => client.listFiles(dir),
    content: (path, etag) => client.readFileContent(path, etag),
  };
}

export function RunSplitScreen(props: {
  client: GatewayClient;
  /** Active run for the left tree; null shows the quiet hint (no run open). */
  runId: string | null;
  /** Settings §B: viewer base font size and optional inventory refresh. */
  viewerFontSize?: number;
  refreshIntervalMs?: number;
}) {
  const dims = useWindowDimensions();
  const layout = resolveSplitLayout(dims.width);
  const api = useMemo(() => createGatewayFileApi(props.client), [props.client]);
  const [sheetOpen, setSheetOpen] = useState(false);

  const left =
    props.runId === null ? (
      <View style={styles.hintPane}>
        <DynText style={styles.hint}>
          No run open — submit a prompt to see its task tree here.
        </DynText>
      </View>
    ) : (
      <View style={styles.treePane}>
        <RunScreen
          client={props.client}
          runId={props.runId}
          paneRefreshMs={props.refreshIntervalMs}
        />
      </View>
    );

  if (layout === "wide") {
    return (
      <View style={styles.row}>
        {left}
        <View style={styles.divider} />
        <View style={styles.viewerPane}>
          <FileViewerPane api={api} viewerFontSize={props.viewerFontSize} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.column}>
      {left}
      <TouchableOpacity
        style={styles.filesButton}
        onPress={() => setSheetOpen(true)}
        activeOpacity={press.activeOpacity}
      >
        <DynText style={styles.filesButtonText}>Files &amp; reports</DynText>
      </TouchableOpacity>
      <ViewerBottomSheet
        open={sheetOpen}
        containerHeight={dims.height}
        onClose={() => setSheetOpen(false)}
      >
        <View style={styles.sheetBody}>
          <FileViewerPane api={api} viewerFontSize={props.viewerFontSize} />
        </View>
      </ViewerBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: "row" },
  column: { flex: 1 },
  treePane: { flex: 1 },
  hintPane: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  hint: { ...type.body, color: colors.inkMute, textAlign: "center" },
  // The one hairline between the panes (§3: separation is one quiet rule).
  divider: { width: 1, backgroundColor: colors.hairline },
  viewerPane: { flex: 1, paddingLeft: space.m },
  // Secondary button tier (canon §3): surface fill + hairline, radius.m —
  // opens the viewer sheet in the narrow layout.
  filesButton: {
    alignSelf: "flex-start",
    marginVertical: space.m,
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    backgroundColor: colors.surface,
  },
  filesButtonText: { ...type.captionStrong, color: colors.inkMute },
  sheetBody: { flex: 1 },
});
