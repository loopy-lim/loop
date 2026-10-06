/**
 * Shared file viewer (split-viewer design §B): the ONE viewer component
 * both containers render — the wide layout docks it as the right pane, the
 * narrow layout hosts it inside the bottom sheet. Presentational + thin:
 * navigation and caching live in the pure FileViewerModel, look lives in
 * ui/ tokens, and the wire surface is the gateway /v1/files pair (§A) via
 * the FileApi port.
 *
 * Lightweight rules (§B): native Text plus virtualized lists only, the
 * closed-grammar markdown parser renders reports as styled text, content
 * loads lazily on open (ETag-revalidated, never polled), no embedded web
 * surface, no new dependencies.
 */
import { useMemo, useState } from "react";
import {
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";

import {
  FileViewerModel,
  joinPath,
  type FileApi,
  type RemoteFileEntry,
  type ViewerPlace,
} from "./file-viewer-model";
import { VIEWER_TARGETS } from "./split-layout";
import { parseMarkdown } from "./markdown";
import { DynText } from "../ui/DynText";
import { Icon } from "../ui/Icon";
import { glyph } from "../ui/glyphs";
import { EMPTY_DIRECTORY_NOTICE } from "../ui/copy";
import { colors, press, radius, space, type } from "../ui/tokens";

const ERROR_COPY: Record<string, string> = {
  not_found: "Not found — the run may not have written it yet.",
  file_too_large: "Too large to view (512 KB cap).",
  file_not_text: "Binary file — text viewing only.",
  file_path_rejected: "Path rejected by the gateway.",
  unauthorized: "Not authorized — reconnect to the gateway.",
  unavailable: "Could not reach the gateway.",
};

const VIEWER_SIZES = [12, 15, 17, 22, type.display.fontSize] as const;
function normalizeViewerSize(size: number): (typeof VIEWER_SIZES)[number] {
  return VIEWER_SIZES.reduce((nearest, candidate) => Math.abs(candidate - size) < Math.abs(nearest - size) ? candidate : nearest);
}
function viewerBodyType(size: number) {
  return size >= type.display.fontSize ? type.display : size >= type.title.fontSize ? type.title : size >= type.body.fontSize ? type.body : type.caption;
}

/** Markdown blocks scaled off the settings' viewer base font size (§B). */
function MarkdownBody(props: { text: string; baseSize: number }) {
  const blocks = useMemo(() => parseMarkdown(props.text), [props.text]);
  const base = props.baseSize;
  return (
    <View>
      {blocks.map((block, index) => {
        if (block.kind === "header") {
          const size = block.level === 1 ? type.display.fontSize : block.level === 2 ? type.title.fontSize : type.bodyStrong.fontSize;
          return (
            <DynText
              key={index}
              style={[styles.mdHeader, size === type.display.fontSize ? type.display : size === type.title.fontSize ? type.title : type.bodyStrong]}
            >
              {block.text}
            </DynText>
          );
        }
        if (block.kind === "bullet") {
          return (
            <DynText key={index} style={[styles.mdBody, viewerBodyType(base)]}>
              {glyph.foldClosed} {block.text}
            </DynText>
          );
        }
        if (block.kind === "code") {
          return (
            <View key={index} style={styles.mdCodeCard}>
              <DynText style={styles.mdCode}>
                {block.text}
              </DynText>
            </View>
          );
        }
        return (
          <DynText key={index} style={[styles.mdBody, viewerBodyType(base)]}>
            {block.text}
          </DynText>
        );
      })}
    </View>
  );
}

function EntryRow(props: { label: string; detail: string; isDir: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={props.onPress}
      activeOpacity={press.activeOpacity}
    >
      <DynText style={styles.rowText} numberOfLines={1}>
        {props.isDir ? glyph.foldClosed : glyph.file} {props.label}
      </DynText>
      <DynText style={styles.rowDetail} numberOfLines={1}>
        {props.detail}
      </DynText>
    </TouchableOpacity>
  );
}

/**
 * The shared viewer pane. `api` is the gateway file surface; the container
 * (RunSplitScreen) decides whether this renders docked or in the sheet.
 */
export function FileViewerPane(props: {
  api: FileApi;
  viewerFontSize?: number;
  style?: ViewStyle;
}) {
  const [model] = useState(() => new FileViewerModel(props.api));
  const [snap, setSnap] = useState(model.snapshot());
  const base = normalizeViewerSize(props.viewerFontSize ?? 15);
  const publish = () => setSnap(model.snapshot());

  const place = snap.place;
  const title =
    place.kind === "targets" ? "Reports" : place.kind === "dir" ? place.dir || "/" : place.path;

  const openEntry = (dir: string, entry: RemoteFileEntry) => {
    const path = joinPath(dir, entry.name);
    void (entry.isDir ? model.openDir(path) : model.openFile(path)).then(publish);
  };

  return (
    <View style={[styles.pane, props.style]}>
      <View style={styles.header}>
        {place.kind !== "targets" ? (
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => void model.up().then(publish)}
            activeOpacity={press.activeOpacity}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon role="back" size={type.title.fontSize} color={colors.inkMute} />
          </TouchableOpacity>
        ) : null}
        <DynText style={styles.title} numberOfLines={1}>
          {title}
        </DynText>
      </View>
      {snap.error !== null ? (
        <DynText style={styles.error}>{ERROR_COPY[snap.error]}</DynText>
      ) : null}
      {place.kind === "targets" ? (
        <FlatList
          data={VIEWER_TARGETS}
          keyExtractor={(target) => target.path}
          renderItem={({ item }) => (
            <EntryRow
              label={item.label}
              detail={item.path}
              isDir={true}
              onPress={() => void model.openTarget(item.path).then(publish)}
            />
          )}
        />
      ) : place.kind === "dir" ? (
        <FlatList
          data={place.entries}
          keyExtractor={(entry) => entry.name}
          renderItem={({ item }) => (
            <EntryRow
              label={item.name}
              detail={item.isDir ? "folder" : `${item.size} B`}
              isDir={item.isDir}
              onPress={() => openEntry(place.dir, item)}
            />
          )}
          ListEmptyComponent={<DynText style={styles.empty}>{EMPTY_DIRECTORY_NOTICE}</DynText>}
        />
      ) : (
        <ScrollView style={styles.contentScroll} contentContainerStyle={styles.content}>
          {place.isMarkdown ? (
            <MarkdownBody text={place.text} baseSize={base} />
          ) : (
            <DynText style={styles.plainText}>
              {place.text}
            </DynText>
          )}
        </ScrollView>
      )}
      {snap.loading ? <DynText style={styles.loading}>Loading…</DynText> : null}
    </View>
  );
}

export type ViewerPlaceSummary = ViewerPlace;

const styles = StyleSheet.create({
  pane: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: space.s,
    minHeight: 44,
  },
  backButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  title: { ...type.title, color: colors.ink, flex: 1 },
  error: { ...type.caption, color: colors.warn, marginBottom: space.s },
  loading: { ...type.caption, color: colors.inkFaint, marginTop: space.xs },
  empty: { ...type.caption, color: colors.inkFaint, marginTop: space.m },
  row: {
    paddingVertical: space.m,
    paddingHorizontal: space.l,
    marginBottom: space.s,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
  },
  rowText: { ...type.body, color: colors.ink },
  rowDetail: { ...type.caption, color: colors.inkFaint, marginTop: space.xxs },
  contentScroll: { flex: 1 },
  content: { paddingBottom: space.xxl },
  mdHeader: { ...type.bodyStrong, color: colors.ink, marginTop: space.m, marginBottom: space.xs },
  mdBody: { color: colors.ink, marginBottom: space.s },
  mdCodeCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.s,
    padding: space.m,
    marginBottom: space.s,
  },
  mdCode: { fontFamily: "Menlo", color: colors.ink },
  plainText: { fontFamily: "Menlo", color: colors.ink },
});
