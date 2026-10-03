// ObjC trampoline for the Swift photo-picker module (task
// `composer-attach-and-highlighting`). Legacy-module registration is driven
// from ObjC: this file registers LoopPhotoPicker (the @objc-exposed Swift
// class in PhotoPicker.swift) with the React Native bridge so
// NativeModules.LoopPhotoPicker resolves on the JS side.
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LoopPhotoPicker, NSObject)
RCT_EXTERN_METHOD(pick:(NSString *)source
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
@end
