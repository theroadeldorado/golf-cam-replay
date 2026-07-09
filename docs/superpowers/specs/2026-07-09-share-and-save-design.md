# Share-to-Phone & Save-to-Disk — Design

**Date:** 2026-07-09 · **Status:** approved by John

Two ways to get a clip off the PC — the second v1 fast-follow. Both act on
the clip currently playing on the replay stage (a fresh capture or one picked
from the rail), via buttons on the replay caption bar.

## Save-to-disk

- **Save** button → native `dialog.showSaveDialog` pre-filled with the clip's
  name (`shot_0042.mp4`) → `copyFile` to the chosen path.
- Main-process only; one IPC channel `clip:saveAs(sessionId, fileName)`,
  resolving to the saved path or `null` if cancelled.
- Test seam: when `REPLAYSWING_SAVEAS_DEST` is set, skip the dialog and copy
  there — lets E2E verify the copy without driving a native dialog.

## Share-to-phone

### Server (`main/share-server.ts`)

- A Node `http` server bound to `0.0.0.0` on an ephemeral port, started
  on-demand at first share and running until **Stop sharing** or app quit.
- One random 128-bit `shareSessionToken`. Shared clips are registered under
  per-clip random tokens in an in-memory map (`token → {sessionId, fileName,
  label, sharedAt}`).
- Routes:
  - `GET /<shareSessionToken>` → the landing page: every shared clip,
    newest first, each with an inline `<video>` and a download link. Small
    JS polls `/<shareSessionToken>/list` so clips shared later appear
    without a manual reload. Instructs iOS (long-press → Save to Photos) and
    Android (download button).
  - `GET /<shareSessionToken>/list` → JSON of shared clips (for polling).
  - `GET /<shareSessionToken>/<clipToken>.mp4` → streams the MP4 with
    **HTTP range support** (206 on `Range`) and `Content-Type: video/mp4`.
  - Anything else, or an unknown/mismatched token → 404.
- Only registered clips are reachable — no directory listing, tokens map to
  known files so path traversal is impossible.
- LAN IP: `os.networkInterfaces()`, first non-internal private IPv4.

### IPC

- `clip:share(sessionId, fileName, label)` → `{ url, token }`. Starts the
  server if needed, registers the clip, returns the landing-page URL
  (`http://<lanIP>:<port>/<shareSessionToken>`).
- `share:stop()` → tears the server down.

### Renderer UI

- **Share** button on the replay caption bar → `clip:share` → draw the QR
  with the existing `qrcode` dep (as in `PairingDialog`) → a share dialog
  showing QR + URL + "same Wi-Fi as your PC" hint, with **Done** (keep
  sharing) and **Stop sharing** (`share:stop`).
- `ReplayInfo` gains `sessionId` + `fileName` so both buttons resolve the
  on-disk file for the currently-playing clip (instant replays are already
  written to disk before replay starts).

## Testing

- **vitest** (`share-server.test.ts`, node env, `127.0.0.1`): register →
  token + URL; `GET /<session>` returns HTML listing a shared clip; `list`
  returns it as JSON; `GET …/<clipToken>.mp4` returns the exact bytes, and a
  `Range` request returns 206 with the correct slice; unknown token → 404;
  private-IPv4 selection helper.
- **Playwright E2E**: capture a clip, click Share, read the URL from the
  dialog, then `fetch` the landing page (HTML) and the `.mp4` (bytes match
  the file on disk). Save-to-disk: set `REPLAYSWING_SAVEAS_DEST`, click Save,
  assert the file was copied there.
