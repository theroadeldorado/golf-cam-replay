import { Github, Download, Bug, DollarSign, BookOpen } from 'lucide-react';

const links = [
  {
    label: 'GitHub Repo',
    href: 'https://github.com/theroadeldorado/replay-swing',
    icon: Github,
    external: true,
  },
  { label: 'Docs', href: '/docs', icon: BookOpen, external: false },
  { label: 'Download', href: '/#download', icon: Download, external: false },
  { label: 'Report Bug', href: '/#bug-report', icon: Bug, external: false },
  {
    label: 'Venmo',
    href: 'https://account.venmo.com/u/theroad2eldorado?txn=pay&amount=20',
    icon: DollarSign,
    external: true,
  },
];

export default function Footer() {
  return (
    <footer className="border-t border-line bg-panel py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div>
            <span className="font-display text-lg font-extrabold tracking-[0.12em] text-fg">
              REPLAY<span className="text-lock">SWING</span>
            </span>
            <p className="mt-1 text-sm text-muted">Made for the golf sim community</p>
          </div>

          <nav className="flex flex-wrap items-center gap-6">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
              >
                <link.icon size={14} />
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-8 border-t border-line pt-6 text-center">
          <p className="font-mono text-xs text-faint">
            MIT License &middot; &copy; {new Date().getFullYear()} ReplaySwing
          </p>
        </div>
      </div>
    </footer>
  );
}
