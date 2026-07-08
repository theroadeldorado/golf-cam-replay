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
    <section id="how-it-works" className="py-20 md:py-28 bg-warm-white">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="font-serif text-4xl md:text-5xl font-bold text-espresso">
            Up and Running in Minutes
          </h2>
          <p className="mt-4 text-lg text-bronze">
            No complex setup. No configuration headaches. Just plug in and play.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((step) => (
            <div key={step.number} className="text-center">
              <div className="relative inline-flex items-center justify-center mb-6">
                <div className="w-20 h-20 rounded-2xl bg-cream border border-sand flex items-center justify-center">
                  <step.icon size={32} className="text-gold" />
                </div>
                <span className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-gold text-white text-sm font-bold flex items-center justify-center shadow-lg">
                  {step.number}
                </span>
              </div>
              <h3 className="font-semibold text-xl text-espresso mb-3">{step.title}</h3>
              <p className="text-bronze leading-relaxed max-w-xs mx-auto">{step.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
