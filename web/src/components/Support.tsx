import { DollarSign, Star, ExternalLink } from 'lucide-react';

export default function Support() {
  return (
    <section id="support" className="border-t border-line py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">Support</p>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Support the project
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            ReplaySwing is free and open source. If it&apos;s helped your game, consider dropping a
            tip.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="https://account.venmo.com/u/theroad2eldorado?txn=pay&amount=20"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#008CFF] px-6 py-3 font-semibold text-white shadow-lg shadow-[#008CFF]/20 transition-colors hover:bg-[#0070CC]"
            >
              <DollarSign size={20} />
              Tip on Venmo
            </a>
            <a
              href="https://github.com/theroadeldorado/replay-swing"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-line-bright bg-panel-raised px-6 py-3 font-semibold text-fg transition-colors hover:border-muted"
            >
              <Star size={20} />
              Star on GitHub
              <ExternalLink size={14} className="text-muted" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
