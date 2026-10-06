import React
import UIKit

/**
 * LoopIcon — the app's SF Symbol icon view (task `fab-icons`, canon v3:
 * docs/design/design-system.md §3 탐색과 아이콘). The JS side
 * (src/ui/Icon.tsx) addresses icons by ROLE; the SF Symbol name arrives
 * from the closed registry (src/ui/glyphs.ts) — this view only knows how
 * to draw one, never which one.
 *
 * Rendering rules:
 * - `UIImage(systemName:withConfiguration:)` sized by `pointSize` (the
 *   token type step the call site passes) and `weight`.
 * - Template mode + `tintColor`: the icon rides the token color roles
 *   (ink ladder, accent, status triad) exactly like text does.
 * - Not an accessibility element: icons are decorative here; the wrapping
 *   control owns the accessibilityLabel.
 *
 * An unknown symbol (older OS) renders nothing rather than guessing —
 * the registry only pins names available at the deployment target.
 */
@objc(LoopIconView)
final class LoopIconView: UIImageView {
  @objc var symbolName: String? { didSet { render() } }
  @objc var color: UIColor? { didSet { render() } }
  @objc var pointSize: CGFloat = 0 { didSet { render() } }
  @objc var weight: String? { didSet { render() } }

  /// `= .zero` keeps `LoopIconView()` callable: implementing the required
  /// `init?(coder:)` below stops the convenience `init()` from being
  /// inherited, so the default argument restores the no-argument call used
  /// by LoopIconManager.view().
  override init(frame: CGRect = .zero) {
    super.init(frame: frame)
    contentMode = .scaleAspectFit
    isAccessibilityElement = false
  }

  required init?(coder: NSCoder) {
    fatalError("LoopIconView is created from code only")
  }

  private func render() {
    guard let name = symbolName, !name.isEmpty, pointSize > 0 else {
      image = nil
      return
    }
    let configuration = UIImage.SymbolConfiguration(
      pointSize: pointSize,
      weight: Self.weight(of: weight)
    )
    image = UIImage(systemName: name, withConfiguration: configuration)?
      .withRenderingMode(.alwaysTemplate)
    tintColor = color ?? .label
  }

  private static func weight(of name: String?) -> UIImage.SymbolWeight {
    switch name {
    case "medium": return .medium
    case "semibold": return .semibold
    case "bold": return .bold
    default: return .regular
    }
  }
}

@objc(LoopIconManager)
final class LoopIconManager: RCTViewManager {
  override static func requiresMainQueueSetup() -> Bool { true }
  override func view() -> UIView! { LoopIconView() }
}
