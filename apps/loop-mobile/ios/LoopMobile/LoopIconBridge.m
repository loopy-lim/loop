// ObjC trampoline for the SF Symbol icon view (task `fab-icons`).
// Legacy-module registration is driven from ObjC: this file registers
// LoopIconManager (the @objc-exposed Swift view manager in LoopIcon.swift)
// with the React Native bridge so requireNativeComponent("LoopIcon")
// resolves on the JS side (src/ui/Icon.tsx). RN strips the "Manager"
// suffix to form the JS-facing view name.
#import <Foundation/Foundation.h>
#import <React/RCTConvert.h>
#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(LoopIconManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(symbolName, NSString)
RCT_EXPORT_VIEW_PROPERTY(color, UIColor)
RCT_EXPORT_VIEW_PROPERTY(pointSize, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(weight, NSString)
@end
