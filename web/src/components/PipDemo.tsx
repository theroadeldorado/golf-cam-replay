import { PipOverlayIllustration } from './illustrations/Illustrations';

export default function PipDemo() {
  return (
    <section className="border-t border-line py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: Visual */}
          <div className="rounded-2xl border border-line-bright bg-panel p-2 shadow-2xl shadow-black/40">
            <PipOverlayIllustration label="Replay floats over your fullscreen simulator" />
          </div>

          {/* Right: Copy */}
          <div>
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">
              PiP overlay
            </p>
            <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight text-fg md:text-5xl">
              Replay without <span className="text-lock">leaving your sim</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted">
              The Picture-in-Picture window floats on top of everything — your simulator software,
              launch monitor, any full-screen app. After each shot, your swing replays
              automatically.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                'Drag and resize the overlay anywhere on screen',
                'Loops automatically — study your swing on repeat',
                'Adjustable playback speed down to 0.1×',
                'Always on top — works with any simulator software',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-[2px] bg-lock" />
                  <span className="text-muted">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
