# ReplaySwing v2 (desktop)

Electron + TypeScript rewrite of the swing capture app. Cameras run on
Chromium's media stack (no OpenCV), the trigger is vision-based (no
microphone), and phones connect by scanning a QR code (no DroidCam).

## Develop

```bash
npm install
npm run dev          # hot-reloading app
npm test             # vitest unit tests (trigger FSM, chunk ring, clip writer, settings)
npm run e2e          # Playwright E2E against the built app (runs npm run build first if out/ is stale)
npm run build        # typecheck + production build into out/
npm run dist:win     # NSIS installer into release/ (CI does this on v2* release tags)
```

E2E uses Chromium's fake camera (`REPLAYSWING_FAKE_MEDIA=1`); no hardware
needed. `REPLAYSWING_DATA_DIR` redirects `~/GolfSwings` for tests.

## Field diagnostics

The packaged exe doubles as a hardware validator:

```bash
ReplaySwing --spike=encode   # WebCodecs H.264: 4×720p concurrent encode + mux + playback check → JSON
ReplaySwing --spike=pip      # canvas→WebRTC loopback for the PiP overlay → JSON
```

Run `--spike=encode` on any machine where capture seems broken — it prints
exactly which encoder configs the machine supports and whether it keeps up.

## Architecture (short version)

- **Main** (`src/main/`): windows, settings (atomic JSON at
  `~/GolfSwings/settings.v2.json`), clip writes (v1-compatible sessions in
  `~/GolfSwings/{timestamp}/` with clips.json), `clip://` protocol,
  auto-update, crash capture, typed IPC (`src/shared/ipc-contract.ts`).
- **Renderer** (`src/renderer/`): all media. One worker per camera
  (`capture/encoder.worker.ts`): frames → WebCodecs H.264 → `ChunkRing`
  (keyframe-aligned circular buffer) → on trigger, mux pre+post roll to MP4.
  The vision trigger (`trigger/vision-trigger.ts`) is a pure FSM fed by
  motion energy sampled in the primary camera's worker. Phone cameras arrive
  over WebRTC (`cameras/phone-source.ts`), signaled through
  replayswing.com/api/signal.
- **PiP** (`src/renderer/src/pip/`): frameless always-on-top window fed by a
  WebRTC loopback of a composite canvas (`playback/program-bus.ts`).

## Ship checklist (open items)

- [ ] Windows validation: packaged `--spike=encode` on real sim PCs
- [ ] Real-device phone test (iOS Safari, Android Chrome) against a deployed
      web preview with Upstash Redis env vars set
- [ ] Sentry DSN + SDK wiring (local crash dumps + logs already in place)
- [ ] Code signing decision (SmartScreen; Azure Trusted Signing ~$10/mo)
