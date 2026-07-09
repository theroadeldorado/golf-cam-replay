# ReplaySwing v2.0.0

A ground-up rebuild. ReplaySwing now **watches your swing through the camera** — no microphone, no impact-sound tuning — and phones connect by **scanning a QR code**, no app to install. Under the hood it's a new Electron app that replaces the old camera engine wholesale, which fixes the crashes and black-camera problems from v1.

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

v1's camera layer was the source of most crashes — black frames from virtual cameras, backend probing, and native segfaults. v2 uses the browser's camera stack instead, so cameras that work in Chrome work here, with stable device IDs and hot-plug support. The microphone trigger and DroidCam are gone entirely.

## Install

Download **ReplaySwing-Setup-2.0.0.exe** below and run it (Windows 10/11, no admin needed). The app is not yet code-signed, so Windows SmartScreen will show "Windows protected your PC" — click **More info → Run anyway**. Auto-updates are built in, so future versions install themselves.

Your existing swings in `~/GolfSwings/` carry over and appear in the gallery.

## Known limitations

- Phone camera requires the phone and PC to be on the **same Wi-Fi** (not cellular or an isolating guest network).
- The installer is unsigned for this release (SmartScreen prompt above).

## Compatibility

Windows 10 and 11. Clips are standard H.264 MP4s that play anywhere.
