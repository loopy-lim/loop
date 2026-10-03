# iOS safe area and native elements diagnosis

## Root cause

The reported symptom does not match the checked-in mobile source or the simulator build produced during this investigation. The app has safe-area handling already: `App.tsx` mounts `SafeAreaProvider` (`apps/loop-mobile/src/App.tsx:313`); the shared `Screen` uses top/left/right insets and bottom scroll padding (`apps/loop-mobile/src/ui/Screen.tsx:36-64`); `AppHeader` reserves the top safe-area zone (`apps/loop-mobile/src/ui/AppHeader.tsx:35-40`); and `ConversationScreen` applies horizontal and bottom insets to its full-screen layout and composer (`apps/loop-mobile/src/screens/ConversationScreen.tsx:167,591-592,704`). The preceding verification report independently records coverage (`docs/findings/ui-redesign-verification.md`, §1).

Consequently, an app-wide absence of safe-area support is not established as root cause. In this source, Connect, Submit, and Pane are children of `Screen` (the App render branches wrap these screens in `Screen`; Pane explicitly documents the wrapper at `apps/loop-mobile/src/screens/PaneScreen.tsx:129`). Conversation owns its layout. Some local edge cases merit review: `Screen` with `scrollable={false}` omits bottom inset padding (`src/ui/Screen.tsx:44-53`), Connect/Submit use `KeyboardAvoidingView behavior="padding"` without an explicit `keyboardVerticalOffset` (`src/screens/ConnectScreen.tsx:75`, `src/screens/SubmitScreen.tsx:78`), and Conversation's jump pill is absolutely positioned in its timeline wrapper (`src/screens/ConversationScreen.tsx:787-791`). These are targeted layout/keyboard risks, not proof that all buttons are outside safe area.

The investigated touch blockers do not show a broad overlay: the only relevant absolute UI located is Conversation's timeline-local jump pill and Composer's local upload/removal badges/buttons (`src/features/composer.tsx:166-176`). No app-wide `pointerEvents` blocker was found in the searched screens/components. A real touch failure still needs reproduction on the affected device/state and hit-target inspection; simulator screenshots/build alone cannot establish tap delivery.

Native capabilities are separate from safe-area layout. `PhotoPicker.swift` implements a registered React Native bridge module and presents system pickers from the active window (`apps/loop-mobile/ios/LoopMobile/PhotoPicker.swift:24-25,43-56,160-164`); its Obj-C bridge registration is in `PhotoPickerBridge.m:9`, and both sources are listed in the Xcode project (`ios/LoopMobile.xcodeproj/project.pbxproj:256-257`). JS reports an explicit unavailable result only if `NativeModules.LoopPhotoPicker` is absent (`src/features/photoPicker.ts:45-68`). Keychain calls are similarly a distinct adapter (`src/auth/keychain.ts:17-32`) and the iOS Pod lock includes RNKeychain 10.0.0 (`ios/Podfile.lock:2343`). Thus safe-area layout cannot itself disable either native module. The present evidence does not establish a failure cause for picker/keychain; investigate module registration/runtime errors, permission/device state (camera; library picker needs no photo permission), and simulator-vs-device behavior separately. A simulator cannot validate secure hardware behavior identically to a physical device.

## Affected surfaces (inset ownership / risk)

- ConnectScreen, SubmitScreen, RunScreen, PaneScreen, and other `Screen` descendants: shared inset boundary in `src/ui/Screen.tsx`; header top inset belongs to `AppHeader` when supplied.
- ConversationScreen: independently handles top/header, landscape sides, composer bottom and keyboard handoff (`src/screens/ConversationScreen.tsx:548-552,591-592,704`). Composer receives calculated bottom padding (`apps/loop-mobile/src/features/composer.tsx`, `paddingBottom` prop).
- AppHeader: interactive flanks share a fixed status-zone height equal to `insets.top` (`src/ui/AppHeader.tsx:35-40`); on unusually short safe-area devices, verify hit boxes remain usable.
- Native interactions: PhotoPicker invoked from ConversationScreen (`src/screens/ConversationScreen.tsx:391`); keychain binding used by App credential restore/save (`src/App.tsx:64`, `src/auth/keychain.ts`). These are not safe-area consumers.

## Minimum corrective action

Do not add a second global safe-area wrapper: that risks double padding and would violate current ownership. First reproduce the exact affected build/device and identify which rendered control's frame/hit target overlaps the system inset. If demonstrated, fix the owning boundary only (shared `Screen` for its descendants, or Conversation's own layout), preserving the keyboard handoff and horizontal landscape insets; ensure non-scrollable `Screen` content has bottom clearance where interactive content can reach the home indicator. For native failures, independently verify the bridge module is present in the installed binary and inspect native promise errors/Keychain return paths; fix registration/linkage or permission/runtime handling as evidenced, not by changing safe-area code.

## Verification evidence and limits

- `bash apps/loop-mobile/scripts/build-ios-simulator.sh` on booted iPhone 17 / iOS 26.2: **BUILD SUCCEEDED**, installed and launched `org.reactjs.native.example.LoopMobile`.
- Direct script invocation lacked executable permission; invoking through bash succeeded.
- Simulator was available and buildable, but this worker did not capture/inspect a reproducible failing screen or automate taps/picker/keychain operations. Therefore no visual/touch or native-operation reproduction is claimed.
- Existing `docs/findings/ui-redesign-verification.md` reports safe-area and prior app checks, but is historical evidence, not a reproduction of the current reported failure.
