import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Camera, useCameraPermission, useObjectOutput } from "react-native-vision-camera";

import { ScanGate, type ScannerPermission } from "../features/qrScanModel";
import { mapCameraPermission } from "../features/qrScanModel";
import { colors, press, radius, space, type } from "../ui/tokens";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * In-app QR scanner (task `mobile-safearea-qr-scan`): the Connect screen's
 * camera entrance for the SAME `loop://connect` payload the system-camera
 * deep link delivers. Every decision lives in features/qrScanModel (pure,
 * bun-tested); this screen only feeds camera events in and renders state —
 * permission fold (fail-safe to blocked), duplicate-frame gating, and the
 * accept/invalid split. Accepted scans stop further scanning and hand the
 * pair to App, which drives the ONE connection path (probe → connect →
 * persist). Manual entry and the system camera deep link remain available;
 * a denied camera permission lands on guidance, never a dead screen.
 *
 * Full-bleed by design: unlike Screen-wrapped surfaces the camera fills the
 * device edge-to-edge and applies the safe-area insets to its own chrome
 * (cancel pill rides insets.top, hint rides insets.bottom) so the notch and
 * home indicator cover only background, never controls.
 */
export function QRScannerScreen(props: {
  /** A validated pairing payload: host/port for the ONE connection path. */
  onPaired: (host: string, port: number) => void;
  /** Back to the manual connect form. */
  onCancel: () => void;
}) {
  const insets = useSafeAreaInsets();
  // v5's hook exposes the reactive status, so "denied forever" (Settings)
  // is distinguishable from the initial not-determined ask without any
  // imperative status probe.
  const { status, hasPermission, requestPermission } = useCameraPermission();
  const permission: ScannerPermission = hasPermission
    ? "ready"
    : mapCameraPermission(status);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const pairedRef = useRef(false);
  // One gate per mount: identical frames inside 1.5s are the same physical
  // scan; a re-aim at another code is evaluated immediately.
  const gateRef = useRef(new ScanGate(1500));

  // Request once when still undetermined; the hook stays reactive across
  // AppState changes, so Settings→allow→return recovers without remount.
  useEffect(() => {
    if (!hasPermission && status === "not-determined") void requestPermission();
  }, [hasPermission, status, requestPermission]);

  // AVCaptureMetadataOutput 기반 코어 QR 감지 — MLKit 프리빌트(arm64 슬라이스가
  // 기기 전용)를 들이지 않고 시뮬레이터와 실기기 모두를 커버한다.
  const objectOutput = useObjectOutput({
    types: ["qr"],
    onObjectsScanned: (objects) => {
      if (pairedRef.current) return; // one accepted scan per screen life
      const first = objects[0];
      const value = first !== undefined && "value" in first ? first.value : undefined;
      if (typeof value !== "string") return;
      const outcome = gateRef.current.offer(value, Date.now());
      if (outcome.kind === "idle") return;
      if (outcome.kind === "invalid") {
        setInvalidMessage(outcome.message);
        return;
      }
      pairedRef.current = true;
      setInvalidMessage(null);
      props.onPaired(outcome.host, outcome.port);
    },
  });

  const cameraActive = permission === "ready" && !pairedRef.current;

  return (
    <View style={styles.root}>
      {cameraActive ? (
        <Camera
          style={StyleSheet.absoluteFill}
          device="back"
          isActive
          outputs={[objectOutput]}
          onError={() => setCameraError(true)}
        />
      ) : null}

      {/* Scan target: a quiet centered frame over the preview (guidance §4 —
       * one emphasis; the frame IS the affordance). */}
      <View style={styles.frameLayer} pointerEvents="none">
        <View style={styles.frame} />
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + space.s }]}>
        <TouchableOpacity
          style={styles.cancel}
          onPress={props.onCancel}
          activeOpacity={press.activeOpacity}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.l }]}>
        {permission === "blocked" ? (
          <Text style={styles.blocked}>
            Camera access is off. Enable it in Settings → LoopMobile, or enter host/port manually.
          </Text>
        ) : permission === "checking" || cameraError ? (
          <Text style={styles.hint}>Starting camera…</Text>
        ) : (
          <Text style={styles.hint}>Point at the loop://connect QR code</Text>
        )}
        {invalidMessage !== null ? <Text style={styles.invalid}>{invalidMessage}</Text> : null}
      </View>
    </View>
  );
}

const FRAME = 240;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  frameLayer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  frame: {
    width: FRAME,
    height: FRAME,
    borderWidth: 2,
    borderColor: colors.inkMute,
    borderRadius: radius.l,
    backgroundColor: "transparent",
  },
  topBar: { paddingHorizontal: space.l },
  // Secondary button tier (canon §3): radius.m — the camera overlay's
  // cancel is still a button, not a pill.
  cancel: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.m,
    paddingVertical: space.s,
    paddingHorizontal: space.l,
    backgroundColor: colors.bg,
  },
  cancelText: { ...type.captionStrong, color: colors.ink },
  bottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: space.xl,
  },
  hint: { ...type.caption, color: colors.inkMute, textAlign: "center" },
  blocked: { ...type.caption, color: colors.ink, textAlign: "center" },
  invalid: { ...type.caption, color: colors.danger, textAlign: "center", marginTop: space.s },
});
