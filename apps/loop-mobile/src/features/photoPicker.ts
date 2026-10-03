/**
 * Photo picker seam (decision 2026-xx-gui-conversation D5; task
 * `composer-attach-and-highlighting`). The composer attach flow depends on
 * this PORT, not on React Native: the app ships a small in-app native
 * module (LoopPhotoPicker — PHPickerViewController for the photo library,
 * UIImagePickerController for the camera), and this file is the only place
 * that touches it.
 *
 * Outcomes are typed and honest: picked (local file uri + bytes metadata),
 * cancelled, denied (camera permission refused — the photo library picker
 * is out-of-process and cannot be denied), unavailable (native module
 * missing on this install, e.g. under headless tests).
 */

import { NativeModules } from "react-native";

/** Which affordance the pick came from (drives the denial phrase). */
export type PhotoSource = "library" | "camera";

/** A picked image: a local file uri for preview/render plus the upload
 * metadata the gateway's allow-list and byte bound are checked against. */
export type PickedPhoto = {
  uri: string;
  mimeType: string;
  byteLen: number;
};

export type PhotoPickOutcome =
  | { kind: "picked"; photo: PickedPhoto }
  | { kind: "cancelled" }
  | { kind: "denied"; source: PhotoSource }
  | { kind: "unavailable"; message: string };

export type PhotoPicker = {
  pickPhoto: (source: PhotoSource) => Promise<PhotoPickOutcome>;
};

/** Native contract of ios/LoopMobile/PhotoPicker.swift (promise resolve). */
type NativePickResult = { uri?: unknown; mimeType?: unknown; byteLen?: unknown };
type NativeLoopPhotoPicker = {
  pick?: (source: string) => Promise<NativePickResult>;
};

/** The app-local native module; undefined on installs without it. */
export function nativePhotoPickerModule(): NativeLoopPhotoPicker | null {
  const candidate = (NativeModules as Record<string, unknown>).LoopPhotoPicker;
  if (typeof candidate !== "object" || candidate === null) return null;
  return candidate as NativeLoopPhotoPicker;
}

/** Validate the native payload — a junk resolve degrades to `unavailable`,
 * never to a half-shaped photo. */
function toPickedPhoto(payload: NativePickResult): PickedPhoto | null {
  const uri = typeof payload.uri === "string" && payload.uri.length > 0 ? payload.uri : null;
  const mimeType =
    typeof payload.mimeType === "string" && payload.mimeType.length > 0 ? payload.mimeType : null;
  const byteLen =
    typeof payload.byteLen === "number" && Number.isFinite(payload.byteLen)
      ? payload.byteLen
      : null;
  if (uri === null || mimeType === null || byteLen === null) return null;
  return { uri, mimeType, byteLen };
}

/** The production picker over the in-app native module. */
export function createNativePhotoPicker(): PhotoPicker {
  return {
    pickPhoto: async (source: PhotoSource): Promise<PhotoPickOutcome> => {
      const native = nativePhotoPickerModule();
      if (native === null || typeof native.pick !== "function") {
        return { kind: "unavailable", message: "LoopPhotoPicker native module is missing" };
      }
      try {
        const photo = toPickedPhoto(await native.pick(source));
        if (photo === null) {
          return { kind: "unavailable", message: "photo picker returned an unusable result" };
        }
        return { kind: "picked", photo };
      } catch (error: unknown) {
        // Legacy-bridge rejections surface as { code, message } payloads.
        const code =
          typeof error === "object" &&
          error !== null &&
          typeof (error as { code?: unknown }).code === "string"
            ? (error as { code: string }).code
            : "";
        if (code === "E_CANCELLED") return { kind: "cancelled" };
        if (code === "E_DENIED") return { kind: "denied", source };
        const message = error instanceof Error ? error.message : String(error);
        return { kind: "unavailable", message };
      }
    },
  };
}

/**
 * Read one picked image for upload — the local-file read port of
 * sendComposerWithAttachments. Returns a Blob produced by the RUNTIME's
 * networking layer (`response.blob()`): React Native's Blob constructor
 * rejects ArrayBuffer/ArrayBufferView parts, so the bytes must never be
 * re-wrapped in JS — the runtime-built blob carries them losslessly. Works
 * for file:// uris (the native picker's output) and http(s) uris (the
 * scripted attach demo's M2 body URL) alike.
 */
export async function readPhotoBlob(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`cannot read picked photo (${response.status})`);
  }
  return response.blob();
}
