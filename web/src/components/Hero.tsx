import { Download, Github } from 'lucide-react';

export default function Hero() {
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-28 overflow-hidden">
      {/* Subtle dot pattern background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, #3D2E1F 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl font-bold text-espresso leading-[1.1] tracking-tight">
              See Every Swing.{' '}
              <span className="text-gold">Improve Every Shot.</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-bronze max-w-lg leading-relaxed">
              A free, open-source app for Windows that sees your swing, records it automatically,
              and replays it instantly — right on top of your simulator. No microphone needed.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="#download"
                className="inline-flex items-center gap-2 bg-green-accent hover:bg-green-hover text-white font-semibold px-6 py-3 rounded transition-colors shadow-lg shadow-green-accent/20"
              >
                <Download size={20} />
                Download Free
              </a>
              <a
                href="https://github.com/theroadeldorado/replay-swing"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 border-2 border-sand hover:border-tan text-espresso font-semibold px-6 py-3 rounded transition-colors"
              >
                <Github size={20} />
                View on GitHub
              </a>
            </div>
          </div>

          {/* Right: App mockup */}
          <div className="relative">
            <div className="bg-charcoal rounded-2xl p-3 shadow-2xl shadow-espresso/20">
              {/* Title bar */}
              <div className="flex items-center gap-2 px-3 py-2 bg-charcoal rounded-t-lg">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <div className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <span className="text-xs text-white/40 ml-2 font-mono">ReplaySwing</span>
              </div>
              {/* App content placeholder */}
              <div className="bg-neutral-900 rounded-lg aspect-[16/10] flex items-center justify-center relative overflow-hidden">
                {/* Simulated camera feed */}
                <div className="absolute inset-0 bg-gradient-to-br from-green-900/30 via-neutral-800 to-neutral-900" />
                <div className="absolute inset-4 border border-white/10 rounded-lg" />

                {/* Controls bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-neutral-800/90 px-4 py-3 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-white/60 text-xs font-mono">ARMED — Watching for your swing...</span>
                  <div className="ml-auto flex gap-2">
                    <div className="w-16 h-2 rounded bg-green-accent/60" />
                    <div className="w-8 h-2 rounded bg-gold/40" />
                  </div>
                </div>

                {/* Center icon */}
                <div className="relative z-10 text-center">
                  <div className="w-16 h-16 mx-auto rounded-full border-2 border-white/20 flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full border-2 border-gold/60" />
                  </div>
                  <p className="text-white/30 text-xs mt-3 font-mono">Camera 1</p>
                </div>
              </div>
            </div>

            {/* PiP overlay preview */}
            <div className="absolute -bottom-4 -right-4 w-40 bg-charcoal rounded-xl p-1.5 shadow-xl shadow-espresso/30 rotate-2">
              <div className="bg-neutral-900 rounded-lg aspect-video flex items-center justify-center">
                <span className="text-[10px] text-white/40 font-mono">PiP Replay</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
