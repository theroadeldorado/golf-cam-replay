import { Download, Github } from 'lucide-react';
import { AppWindowIllustration } from './illustrations/Illustrations';

export default function Hero() {
  return (
    <section className="relative overflow-hidden pt-36 pb-20 md:pt-44 md:pb-28">
      {/* Instrument-grid backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            'linear-gradient(#1a2320 1px, transparent 1px), linear-gradient(90deg, #1a2320 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse 90% 60% at 50% 0%, #000 30%, transparent 75%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 90% 60% at 50% 0%, #000 30%, transparent 75%)',
        }}
      />
      {/* Amber glow, like the tally lamp */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-watch/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Left: Copy */}
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-lock" />
              Free &amp; open source · Windows
            </div>

            <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-fg md:text-6xl lg:text-7xl">
              See every swing.{' '}
              <span className="text-lock">Improve every shot.</span>
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted md:text-xl">
              A desktop app that <em className="not-italic text-fg">sees</em> your swing on
              camera, records it the instant you swing, and loops the replay right on top of your
              simulator. No microphone required.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#download"
                className="inline-flex items-center gap-2 rounded-lg bg-lock px-6 py-3 font-semibold text-ink shadow-lg shadow-lock/20 transition-colors hover:bg-lock-bright"
              >
                <Download size={20} />
                Download Free
              </a>
              <a
                href="https://github.com/theroadeldorado/replay-swing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-line-bright bg-panel-raised px-6 py-3 font-semibold text-fg transition-colors hover:border-muted"
              >
                <Github size={20} />
                View on GitHub
              </a>
            </div>

            <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-6">
              {[
                { v: 'No mic', k: 'Camera-based trigger' },
                { v: '4 cams', k: 'USB + phone angles' },
                { v: '0.1×', k: 'Slow-mo replay' },
              ].map((s) => (
                <div key={s.k}>
                  <dt className="font-display text-2xl font-extrabold text-fg">{s.v}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-wider text-faint">
                    {s.k}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right: App window illustration */}
          <div className="relative">
            <div className="rounded-2xl border border-line-bright bg-panel p-1.5 shadow-2xl shadow-black/50">
              <AppWindowIllustration label="ReplaySwing armed and watching for a swing" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
