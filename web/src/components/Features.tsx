import {
  Eye,
  PictureInPicture2,
  Camera,
  RotateCcw,
  Timer,
  FolderOpen,
  Heart,
  Star,
  QrCode,
  PenTool,
  Columns2,
  Gauge,
  Share2,
} from 'lucide-react';

const features = [
  {
    icon: Eye,
    title: 'Sees Your Swing',
    description:
      'No microphone, no impact-sound tuning. ReplaySwing watches the camera: you settle at address, you swing, it records. Practice waggles and people walking by don’t fire it.',
  },
  {
    icon: Timer,
    title: 'Never Misses the Backswing',
    description:
      'A rolling buffer keeps the seconds before the trigger, so every clip includes your full setup and backswing — not just the follow-through.',
  },
  {
    icon: QrCode,
    title: 'Phone Camera in Ten Seconds',
    description:
      'Scan a QR code and your phone becomes a wireless camera in its browser. No app to install, no IP addresses to type. Video stays on your Wi-Fi.',
  },
  {
    icon: PictureInPicture2,
    title: 'Replay on Your Sim Screen',
    description:
      'A floating overlay sits on top of your simulator and mirrors the app — live view between shots, looping replay right after each swing.',
  },
  {
    icon: Camera,
    title: 'Multi-Camera Angles',
    description:
      'Record face-on and down-the-line at once — up to four USB cameras and phones, all captured from the same trigger.',
  },
  {
    icon: RotateCcw,
    title: 'Instant Replay',
    description:
      'Looping playback starts automatically after every shot, and you stay armed — just step up and hit the next ball.',
  },
  {
    icon: Gauge,
    title: 'Slow Motion',
    description:
      'Slow any replay down to a tenth speed to study the moment through impact frame by frame.',
  },
  {
    icon: Columns2,
    title: 'Compare Swings',
    description:
      'Put two swings side by side on one synced timeline — today’s against a reference from last week — and nudge them into alignment at impact.',
  },
  {
    icon: PenTool,
    title: 'Drawing Tools',
    description:
      'Draw swing-plane lines and alignment circles right on the video. They stick to each camera and show up on the replay and the sim overlay.',
  },
  {
    icon: FolderOpen,
    title: 'Session Library',
    description:
      'Every shot lands in a session with thumbnails. Browse past sessions and replay any swing with one click.',
  },
  {
    icon: Share2,
    title: 'Send to Your Phone',
    description:
      'Beam any clip to your phone with a QR code, or save it anywhere on your PC. Everything stays on your local network.',
  },
  {
    icon: Star,
    title: 'Pin Favorite Shots',
    description: 'Pin your best swings for quick access, delete the mishits.',
  },
  {
    icon: Heart,
    title: 'Free & Open Source',
    description: 'MIT licensed. No subscriptions, no accounts, no data collection. Yours forever.',
  },
];

export default function Features() {
  return (
    <section id="features" className="border-t border-line py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto mb-16 max-w-2xl text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">Features</p>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Everything you need
          </h2>
          <p className="mt-4 text-lg text-muted">
            Built specifically for golf simulator setups. Every feature designed to help you
            improve without leaving your bay.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-line bg-panel p-6 transition-colors hover:border-line-bright hover:bg-panel-raised"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-ink transition-colors group-hover:border-lock/40">
                <feature.icon size={22} className="text-lock" />
              </div>
              <h3 className="mb-2 font-display text-base font-bold text-fg">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{feature.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
