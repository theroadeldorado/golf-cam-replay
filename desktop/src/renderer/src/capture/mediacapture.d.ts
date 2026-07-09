/** Chromium's mediacapture-transform API — not yet in TypeScript's DOM lib. */
declare class MediaStreamTrackProcessor<T = VideoFrame> {
  constructor(init: { track: MediaStreamTrack; maxBufferSize?: number })
  readonly readable: ReadableStream<T>
}
