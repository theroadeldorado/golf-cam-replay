import { Camera, Disc3, Play } from 'lucide-react';

const steps = [
  {
    number: '01',
    icon: Camera,
    title: 'Set Up Your Camera',
    description:
      'Plug in a USB camera — or scan a QR code and your phone becomes a wireless camera in its browser. No apps, no IP addresses.',
  },
  {
    number: '02',
    icon: Disc3,
    title: 'Arm & Swing',
    description:
      'Hit Arm and take your shot. The app watches the camera — when you settle at address and swing, it records automatically. No microphone needed.',
  },
  {
    number: '03',
    icon: Play,
    title: 'Review Instantly',
    description:
      'Your swing replays automatically in a floating PiP window right on top of your simulator screen.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-t border-line bg-panel/40 py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">How it works</p>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Up and running in minutes
          </h2>
          <p className="mt-4 text-lg text-muted">
            No complex setup. No configuration headaches. Just plug in and play.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-3 md:gap-6">
          {steps.map((step) => (
            <div
              key={step.number}
              className="relative rounded-xl border border-line bg-panel p-6 text-center"
            >
              <span className="absolute right-5 top-5 font-mono text-xs text-faint">
                {step.number}
              </span>
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-line bg-ink">
                <step.icon size={28} className="text-lock" />
              </div>
              <h3 className="mb-3 font-display text-lg font-bold text-fg">{step.title}</h3>
              <p className="mx-auto max-w-xs leading-relaxed text-muted">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
