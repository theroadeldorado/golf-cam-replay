# ReplaySwing

Free, open-source golf swing capture and replay for Windows — record swings with
automatic (motion + audio) trigger capture, multi-camera support, drawing tools,
side-by-side comparison, and a Picture-in-Picture overlay for golf simulators.

**Live site:** [replayswing.com](https://replayswing.com)

## Monorepo layout

- **`desktop/`** — the ReplaySwing desktop app (Electron + TypeScript). Cameras run
  on Chromium's media stack (WebCodecs H.264), the trigger is a hybrid motion+audio
  FSM, and phones join by scanning a QR code (no DroidCam). See
  [`desktop/README.md`](desktop/README.md) for architecture.
- **`web/`** — the marketing website at replayswing.com (Next.js). Also hosts the
  phone-camera page (`/camera`) and the WebRTC signaling relay (`/api/signal`) the
  desktop app pairs through. See [`web/README.md`](web/README.md).

> The original v1 Python/PyQt6 app was replaced by the v2 Electron rewrite. Its
> history remains in git before the `v2` merge.

## Getting started

### Desktop

```bash
cd desktop
npm install
npm run dev          # hot-reloading app
npm test             # vitest unit tests
npm run build        # typecheck + production build
```

### Web

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

The web package needs a `GITHUB_TOKEN` (bug-report form + release download links) and,
in production, Upstash Redis env vars for the phone-camera signaling relay. Copy
`web/.env.example` to `web/.env.local` and fill in the values.
