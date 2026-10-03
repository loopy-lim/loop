import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // Showcase/demo hook (task `simulator-showcase`): launch-environment vars
    // (set via `SIMCTL_CHILD_* xcrun simctl launch …`) become initialProps for
    // the root component. Values live in process memory only; with no env set
    // behavior is unchanged.
    var showcase: [String: Any] = [:]
    let env = ProcessInfo.processInfo.environment
    if let bearer = env["LOOP_SHOWCASE_BEARER"], !bearer.isEmpty { showcase["bearer"] = bearer }
    if let host = env["LOOP_SHOWCASE_HOST"], !host.isEmpty { showcase["host"] = host }
    if let port = env["LOOP_SHOWCASE_PORT"], !port.isEmpty { showcase["port"] = port }
    if let prompt = env["LOOP_SHOWCASE_PROMPT"] { showcase["prompt"] = prompt }
    if env["LOOP_SHOWCASE_CONNECT"] == "1" { showcase["autoConnect"] = true }
    if env["LOOP_SHOWCASE_SUBMIT"] == "1" { showcase["autoSubmit"] = true }
    if let delay = env["LOOP_SHOWCASE_SUBMIT_DELAY_MS"], let ms = Int(delay) { showcase["submitDelayMs"] = ms }
    if env["LOOP_SHOWCASE_LOGOUT"] == "1" { showcase["autoLogout"] = true }
    if let logoutDelay = env["LOOP_SHOWCASE_LOGOUT_DELAY_MS"], let ms = Int(logoutDelay) { showcase["autoLogoutDelayMs"] = ms }
    if let pane = env["LOOP_SHOWCASE_OPEN_PANE"], !pane.isEmpty { showcase["autoOpenPaneId"] = pane }
    if let paneDelay = env["LOOP_SHOWCASE_OPEN_PANE_DELAY_MS"], let ms = Int(paneDelay) { showcase["autoOpenPaneDelayMs"] = ms }
    if let steer = env["LOOP_SHOWCASE_STEER"], !steer.isEmpty { showcase["autoSteerText"] = steer }
    if let steerDelay = env["LOOP_SHOWCASE_STEER_DELAY_MS"], let ms = Int(steerDelay) { showcase["autoSteerDelayMs"] = ms }
    if let openRun = env["LOOP_SHOWCASE_OPEN_RUN"], !openRun.isEmpty { showcase["autoOpenRunId"] = openRun }
    if let openSession = env["LOOP_SHOWCASE_OPEN_SESSION"], !openSession.isEmpty { showcase["autoOpenSessionId"] = openSession }
    if let scrollUp = env["LOOP_SHOWCASE_SCROLL_UP_DELAY_MS"], let ms = Int(scrollUp) { showcase["autoScrollUpDelayMs"] = ms }
    if let composerDraft = env["LOOP_SHOWCASE_COMPOSER_DRAFT"] { showcase["composerDraft"] = composerDraft }
    if let attachAssets = env["LOOP_SHOWCASE_ATTACH_ASSETS"], !attachAssets.isEmpty {
      showcase["attachAssetIds"] = attachAssets.components(separatedBy: ",").filter { !$0.isEmpty }
    }
    if let attachDelay = env["LOOP_SHOWCASE_ATTACH_DELAY_MS"], let ms = Int(attachDelay) { showcase["attachDelayMs"] = ms }
    if let attachSend = env["LOOP_SHOWCASE_ATTACH_SEND_DELAY_MS"], let ms = Int(attachSend) { showcase["attachSendDelayMs"] = ms }
    if let backDelay = env["LOOP_SHOWCASE_BACK_DELAY_MS"], let ms = Int(backDelay) { showcase["autoBackDelayMs"] = ms }
    // QR pairing deep link (decision 2026-xx-qr-pairing D-B): a system-camera
    // scan (or its automation equivalent, `simctl openurl`) cold-launches the
    // app with the loop:// payload in the launch options — the same
    // continuation the scan's banner link feeds. Only the loop scheme drives
    // pairing; any other launch URL is ignored.
    if let launchUrl = launchOptions?[.url] as? URL, launchUrl.scheme?.lowercased() == "loop" {
      showcase["pairingUrl"] = launchUrl.absoluteString
    }
    // Keys only — bearer values are never logged (AGENTS.md).
    NSLog("showcase-launch: keys=[%@]", showcase.keys.sorted().joined(separator: ","))

    factory.startReactNative(
      withModuleName: "LoopMobile",
      in: window,
      initialProperties: showcase.isEmpty ? nil : ["showcase": showcase],
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
