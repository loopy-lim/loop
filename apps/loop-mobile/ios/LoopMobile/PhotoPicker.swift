import AVFoundation
import Foundation
import PhotosUI
import React
import UIKit
import UniformTypeIdentifiers

/**
 * LoopPhotoPicker — the app's photo-pick native module (decision
 * 2026-xx-gui-conversation D5; task `composer-attach-and-highlighting`).
 *
 * One bridge method, `pick(source, resolver, rejecter)`:
 * - "library": PHPickerViewController — out-of-process, needs NO photo
 *   library permission; empty selection resolves as cancelled.
 * - "camera":  UIImagePickerController after an explicit AVFoundation
 *   authorization check — a refusal rejects E_DENIED (the JS side maps it
 *   to the honest Settings notice) instead of presenting a dead viewfinder.
 *
 * A picked image is written to a fresh temp file and resolved as
 * { uri, mimeType, byteLen } — the shape src/media/photoPicker.ts validates.
 * Rejections: E_CANCELLED, E_DENIED, E_ALREADY_PRESENTING, E_NO_WINDOW,
 * E_PICKER_FAILED. One pick at a time (guard against double-present).
 */
@objc(LoopPhotoPicker)
final class LoopPhotoPicker: NSObject, PHPickerViewControllerDelegate,
  UIImagePickerControllerDelegate, UINavigationControllerDelegate {

  private var pendingResolve: RCTPromiseResolveBlock?
  private var pendingReject: RCTPromiseRejectBlock?
  private var pendingSource: String = "library"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc(pick:resolver:rejecter:)
  func pick(_ source: NSString,
            resolver: @escaping RCTPromiseResolveBlock,
            rejecter: @escaping RCTPromiseRejectBlock) {
    DispatchQueue.main.async {
      if self.pendingResolve != nil {
        rejecter("E_ALREADY_PRESENTING", "A photo pick is already in progress.", nil)
        return
      }
      self.pendingResolve = resolver
      self.pendingReject = rejecter
      self.pendingSource = source as String
      guard let root = Self.rootViewController() else {
        self.reject("E_NO_WINDOW", "No window to present the photo picker.")
        return
      }
      if self.pendingSource == "camera" {
        self.presentCamera(from: root)
      } else {
        self.presentLibrary(from: root)
      }
    }
  }

  // MARK: - Presentation

  private func presentLibrary(from root: UIViewController) {
    var configuration = PHPickerConfiguration()
    configuration.filter = .images
    configuration.selectionLimit = 1
    let picker = PHPickerViewController(configuration: configuration)
    picker.delegate = self
    root.present(picker, animated: true)
  }

  private func presentCamera(from root: UIViewController) {
    // Honest denial: check before presenting, never a black viewfinder.
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .denied, .restricted:
      reject("E_DENIED", "Camera access is denied.")
    default:
      // .notDetermined lets the system prompt run here; .authorized flows in.
      AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
        DispatchQueue.main.async {
          guard let self else { return }
          guard granted else {
            self.reject("E_DENIED", "Camera access is denied.")
            return
          }
          let picker = UIImagePickerController()
          picker.sourceType = .camera
          picker.delegate = self
          root.present(picker, animated: true)
        }
      }
    }
  }

  // MARK: - PHPickerViewControllerDelegate (library)

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider,
          provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
      // Empty selection == cancelled; nothing was picked.
      resolve(nil)
      return
    }
    // The completion carries no type identifier — read the preferred image
    // type off the provider up front (png/jpeg/webp/gif keep their real
    // media type; the generic image type is the honest fallback).
    let imageTypes = provider.registeredTypeIdentifiers.compactMap(UTType.init)
      .filter { $0.conforms(to: .image) }
    let preferred =
      imageTypes.first { $0.conforms(to: .png) }
      ?? imageTypes.first { $0.conforms(to: .jpeg) }
      ?? imageTypes.first { $0.conforms(to: .webP) }
      ?? imageTypes.first { $0.conforms(to: .gif) }
      ?? imageTypes.first
      ?? UTType.image
    provider.loadDataRepresentation(forTypeIdentifier: preferred.identifier) { data, error in
      DispatchQueue.main.async {
        guard let data, !data.isEmpty, error == nil else {
          self.reject("E_PICKER_FAILED", "Could not read the selected image.")
          return
        }
        let mimeType = preferred.preferredMIMEType ?? "application/octet-stream"
        let ext = preferred.preferredFilenameExtension ?? "img"
        self.finish(data: data, mimeType: mimeType, filenameExtension: ext)
      }
    }
  }

  // MARK: - UIImagePickerControllerDelegate (camera)

  func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    picker.dismiss(animated: true)
    guard let image = info[.originalImage] as? UIImage,
          let data = image.jpegData(compressionQuality: 0.9) else {
      reject("E_PICKER_FAILED", "Could not read the captured photo.")
      return
    }
    finish(data: data, mimeType: "image/jpeg", filenameExtension: "jpg")
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    resolve(nil)
  }

  // MARK: - Outcome plumbing

  /** Write the bytes to a fresh temp file and resolve the JS payload. */
  private func finish(data: Data, mimeType: String, filenameExtension: String) {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("loop-attach-\(UUID().uuidString).\(filenameExtension)")
    do {
      try data.write(to: url, options: .atomic)
    } catch {
      reject("E_PICKER_FAILED", "Could not stage the picked image.")
      return
    }
    resolve([
      "uri": url.absoluteString,
      "mimeType": mimeType,
      "byteLen": data.count,
    ])
  }

  private func resolve(_ payload: Any?) {
    pendingResolve?(payload)
    pendingResolve = nil
    pendingReject = nil
  }

  private func reject(_ code: String, _ message: String) {
    pendingReject?(code, message, nil)
    pendingResolve = nil
    pendingReject = nil
  }

  private static func rootViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    return scene?.keyWindow?.rootViewController ?? scene?.windows.first(where: \.isKeyWindow)?.rootViewController
  }
}
