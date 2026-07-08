# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Structure

Monorepo with three packages:

- **`app/`** — v1 desktop swing capture application (Python/PyQt6, targets Windows) — maintenance only
- **`desktop/`** — v2 desktop app (Electron/TypeScript) — active development on the `v2` branch; see `desktop/README.md`
- **`web/`** — Marketing website at replayswing.com (Next.js/TypeScript), also hosts the phone-camera page (`/camera`) and WebRTC signaling relay (`/api/signal`) for v2

## Common Commands

### Desktop v2 (Electron)

```bash
cd desktop && npm install
npm run dev          # hot-reloading app
npm test             # vitest unit tests
npm run e2e          # Playwright E2E (fake camera, no hardware needed)
npm run build        # typecheck + production build
```

Key v2 facts: WebCodecs H.264 + ChunkRing recording pipeline (no OpenCV), vision-based
trigger (no microphone), phone cameras via QR → browser → WebRTC (no DroidCam), sessions
written in the v1-compatible `~/GolfSwings/{timestamp}/clips.json` format. Gotcha:
MediaStreamTrack is NOT transferable in Electron — transfer the MediaStreamTrackProcessor's
ReadableStream to workers instead.

### App v1 (Python)

```bash
# Install dependencies (from app/)
pip install -r app/requirements.txt

# Run the application
python app/swing_capture.py

# Run all tests
python -m pytest app/tests/ -v

# Run a single test file
python -m pytest app/tests/test_config.py -v

# Run tests matching a pattern
python -m pytest app/tests/ -v -k "camera"
```

No linter or formatter is configured for Python.

### Web (Next.js)

```bash
# Install dependencies (from web/)
cd web && npm install

# Dev server
cd web && npm run dev

# Build
cd web && npm run build

# Lint
cd web && npm run lint
```

## App Architecture

Entry point: `app/swing_capture.py`. PyQt6 desktop app that records golf swings via audio-triggered capture with USB/network cameras.

### Signal-Driven Threading Model

All heavy I/O runs in QThreads communicating with the main UI via pyqtSignals — never direct callbacks:

- **CameraCapture** (QThread per camera) → `frame_ready(camera_id, frame, timestamp)`
- **AudioDetector** (QThread) → `trigger_detected(confidence, features)`
- **MainWindow** receives signals, updates UI, manages recording

Thread safety: `threading.Lock()` on shared state (frame buffers, audio classifier, camera transforms).

### Module Map

| Module | Role |
|---|---|
| `swing_capture.py` | MainWindow — UI state machine, playback, dialogs, keyboard shortcuts |
| `camera_engine.py` | CameraCapture thread, per-camera transforms, PersonDetector (HOG+SVM), network camera utilities |
| `audio_engine.py` | AudioDetector thread, AudioFeatureExtractor (12 spectral features), AudioClassifier (heuristic + RandomForest) |
| `recording.py` | FrameBuffer (circular pre-trigger buffer), RecordingManager (save/delete clips, clips.json metadata) |
| `config.py` | AppConfig/CameraPreset dataclasses, JSON persistence with atomic writes |
| `drawing_overlay.py` | Shape hierarchy (Line/Circle), transparent overlay widget, normalized 0.0–1.0 coordinates |
| `comparison_view.py` | ComparisonWindow — side-by-side synchronized playback with frame offset |
| `ui_components.py` | VideoPlayer, PiPWindow, ClipGallery, LogPanel, `composite_grid()` |

### Recording Workflow

Arm → AudioDetector fires trigger → RecordingManager saves pre-buffer (2s) + post-trigger (4s) from all cameras → auto-playback loops → stays armed for next shot.

### Key Patterns

- **Graceful degradation**: Optional imports (PyAudio, scikit-learn, qrcode) wrapped in try/except with feature flags (`AUDIO_AVAILABLE`, `SKLEARN_AVAILABLE`). Always check these flags before touching audio/ML code.
- **Normalized coordinates**: Drawing overlay uses 0.0–1.0 relative coords that survive window resizing.
- **Config persistence**: JSON with temp-file-then-rename for atomic writes to `~/GolfSwings/settings.json`.
- **Session storage**: `~/GolfSwings/{timestamp}/` folders with clips.json, MP4s, and JPG thumbnails.
- **Audio classifier dual mode**: Heuristic (hand-tuned spectral weights, default) switches to RandomForest after 10+ user-labeled samples in `~/GolfSwings/training_data/`.

## Web Architecture

Next.js App Router with Tailwind CSS v4. Single-page marketing site at `/`, documentation at `/docs`, and a bug report API at `/api/bug-report` (proxies to GitHub Issues).

Requires `GITHUB_TOKEN` env var (see `web/.env.example`) for the bug report endpoint and release download links.

## CI/CD

GitHub Actions workflow (`.github/workflows/build-release.yml`) builds a Windows .exe via PyInstaller on release creation, then uploads it to the GitHub Release.

## Custom Skills

`.claude/commands/` contains task-specific prompts: `dev.md`, `test.md`, `qa.md`, `review.md`, `ui.md`, `golf-consultant.md`, `mock-camera.md`, `update-docs.md`.
