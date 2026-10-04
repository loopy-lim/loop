import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Camera, useCameraDevice, useCodeScanner, useCameraPermission } from "react-native-vision-camera";

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
  // v4's hook exposes hasPermission/requestPermission; the raw status comes
  // from Camera so "denied forever" (Settings) is distinguishable from the
  // initial not-determined ask.
  const { hasPermission, requestPermission } = useCameraPermission();
  const [permission, setPermission] = useState<ScannerPermission>(() =>
    hasPermission ? "ready" : mapCameraPermission(Camera.getCameraPermissionStatus()),
  );
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const pairedRef = useRef(false);
  // One gate per mount: identical frames inside 1.5s are the same physical
  // scan; a re-aim at another code is evaluated immediately.
  const gateRef = useRef(new ScanGate(1500));
  const device = useCameraDevice("back");

  // Request once when still undetermined; re-fold whenever the hook's
  // permission flips (it also refreshes on AppState changes, so
  // Settings→allow→return recovers without remount).
  useEffect(() => {
    if (!hasPermission && Camera.getCameraPermissionStatus() === "not-determined") {
      void requestPermission();
    }
  }, [hasPermission, requestPermission]);
  useEffect(() => {
    setPermission(
      hasPermission ? "ready" : mapCameraPermission(Camera.getCameraPermissionStatus()),
    );
  }, [hasPermission]);

  const codeScanner = useCodeScanner({
    codeTypes: ["qr"],
    onCodeScanned: (codes) => {
      if (pairedRef.current) return; // one accepted scan per screen life
      const value = codes[0]?.value;
      if (value === undefined) return;
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

  const cameraActive = permission === "ready" && device != null && !pairedRef.current;

  return (
    <View style={styles.root}>
      {cameraActive ? (
        <Camera style={StyleSheet.absoluteFill} device={device} isActive codeScanner={codeScanner} />
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
        ) : permission === "checking" || device == null ? (
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
  frameLayer: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: {
    width: FRAME,
    height: FRAME,
    borderWidth: 2,
    borderColor: colors.inkMute,
    borderRadius: radius.l,
    backgroundColor: "transparent",
  },
  topBar: { paddingHorizontal: space.l },
  cancel: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radius.pill,
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
