# ReplaySwing 0.4.2-beta

## What's new in 0.4.2

**Person-aware trigger.** The app now only arms when it actually sees a person in the hitting zone. Combined with the swing-shape filter from 0.4.1, this means it won't go "Set" on an empty bay, won't fire when someone walks past, and won't record a phantom shot when you step back into frame. Runs on-device — nothing leaves your PC. You can turn it off under Settings → "Require a person in view" for unusual camera setups, and it automatically falls back to swing-shape detection if the detector can't start.

## From 0.4.1

**Smarter swing detection — fewer false shots.** The trigger recognizes the *shape* of a real swing (a sharp burst that quickly settles) instead of firing on any motion. Walking around the bay or a big pre-shot fidget no longer records a phantom shot. The "hold still to arm" moment is ~1s so the app locks onto your address more reliably.

---

A ground-up rebuild. ReplaySwing **watches your swing through the camera** — no microphone, no impact-sound tuning — and phones connect by **scanning a QR code**, no app to install. Under the hood it's a new app that replaces the old camera engine wholesale, which fixes the crashes and black-camera problems from earlier builds.

## Highlights

- **Sees your swing — no microphone.** Settle at address, swing, and it records automatically. Waggles and people walking through the frame don't trigger it. Adjust sensitivity in Settings, or trigger manually anytime with the button or `T`.
- **Never misses the backswing.** A rolling buffer keeps the seconds before the trigger, so every clip has your full setup — not just the follow-through.
- **Phone camera in ten seconds.** Scan a QR code and your phone becomes a wireless camera in its browser. No app, no IP addresses, no DroidCam. Video stays on your Wi-Fi.
- **Instant replay + slow motion.** Every shot loops on screen the moment it saves. Drag the speed slider from 1× down to 0.1× to study impact frame by frame.
- **Compare swings.** Put two swings side by side on one synced timeline — today's against a reference from last week — and nudge them into alignment at impact.
- **Drawing tools.** Draw swing-plane lines and alignment circles right on the video. They stick to each camera and show on the replay and the sim overlay.
- **Send to your phone / save anywhere.** Beam any clip to your phone with a QR code, or save it to your PC. Everything stays on your local network.
- **PiP overlay** that floats over your fullscreen simulator, **multi-camera** capture (up to four USB cameras and phones), and a **session library** with thumbnails, pinning, and delete.

## Why the rewrite

The old camera layer was the source of most crashes — black frames from virtual cameras, backend probing, and native segfaults. This rebuild uses the browser's camera stack instead, so cameras that work in Chrome work here, with stable device IDs and hot-plug support. The microphone trigger and DroidCam are gone entirely.

## Install

Download **ReplaySwing-Setup-0.4.2-beta.exe** below and run it (Windows 10/11, no admin needed). The app is not yet code-signed, so Windows SmartScreen will show "Windows protected your PC" — click **More info → Run anyway**. Auto-updates are built in, so future versions install themselves.

Your existing swings in `~/GolfSwings/` carry over and appear in the gallery.

## Known limitations

- Phone camera requires the phone and PC to be on the **same Wi-Fi** (not cellular or an isolating guest network).
- The installer is unsigned for this release (SmartScreen prompt above).

## Compatibility

Windows 10 and 11. Clips are standard H.264 MP4s that play anywhere.
