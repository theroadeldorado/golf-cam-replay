# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

Monorepo with two packages:

- **`desktop/`** — ReplaySwing desktop app (Electron/TypeScript). See `desktop/README.md` for architecture.
- **`web/`** — Marketing website at replayswing.com (Next.js/TypeScript). Also hosts the phone-camera page (`/camera`) and the WebRTC signaling relay (`/api/signal`) the desktop app pairs through.

The v1 Python/PyQt6 app was removed after the v2 rewrite; its history lives in git (last present at tag/commits before the `v2` merge).

## Common Commands

### Desktop (Electron)

```bash
cd desktop && npm install
npm run dev          # hot-reloading app
npm test             # vitest unit tests
npm run e2e          # Playwright E2E (fake camera, no hardware needed)
npm run build        # typecheck + production build
npm run dist:win     # NSIS installer (CI does this on v2* release tags)
```

Field diagnostics: the packaged exe runs `--spike=encode` (WebCodecs H.264 validation)
and `--spike=pip` (PiP loopback validation), printing JSON reports.

### Web (Next.js)

```bash
cd web && npm install
npm run dev
npm run build
npm run lint
```

Requires `GITHUB_TOKEN` (see `web/.env.example`) for bug reports + release download links,
and `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` for the phone-camera signaling
relay in production (falls back to in-memory for local dev).

## Desktop Architecture (key facts)

- **Main process** (`desktop/src/main/`): windows, atomic-write settings at
  `~/GolfSwings/settings.v2.json`, clip writes, `clip://` protocol, auto-update
  (electron-updater + GitHub Releases), crash capture. All IPC is typed via
  `src/shared/ipc-contract.ts`.
- **Renderer** owns all media: one worker per camera (`capture/encoder.worker.ts`)
  runs frames → WebCodecs H.264 → ChunkRing (keyframe-aligned circular buffer) →
  mp4-muxer on trigger. The swing trigger (`trigger/swing-trigger.ts`) is a pure,
  unit-tested hybrid FSM: a vision-first path (stillness at address → motion spike
  → confirmed by an impact sound) plus an audio-first path (loud burst + recent
  motion). Motion energy comes from the primary camera's worker; audio level from
  `trigger/audio-trigger.ts`; `trigger/presence-gate.ts` (MediaPipe pose) can
  auto-arm capture only when a person is in frame.
- **Phone cameras**: QR → `replayswing.com/camera?s={session}` → WebRTC offer,
  signaled through polling API routes; media is P2P on the LAN. No DroidCam.
- **PiP overlay**: separate frameless always-on-top window fed by a WebRTC loopback
  of a composite canvas (`playback/program-bus.ts`).
- **Sessions**: `~/GolfSwings/{timestamp}/` with `clips.json`, MP4s, JPG thumbnails
  (v1-compatible format — old sessions appear in the gallery).
- **Gotcha**: MediaStreamTrack is NOT transferable in Electron — transfer the
  MediaStreamTrackProcessor's ReadableStream to workers instead.
- E2E uses Chromium fake-media flags via env: `REPLAYSWING_FAKE_MEDIA=1`,
  `REPLAYSWING_FAKE_MEDIA_FILE=<y4m>`, plus `REPLAYSWING_DATA_DIR` and
  `REPLAYSWING_WEB_BASE` overrides.

## CI/CD

`.github/workflows/build-desktop-v2.yml` builds and publishes the NSIS installer +
auto-update metadata to the GitHub Release on `v2*` tags (also runs tests). The
website deploys via Vercel.
