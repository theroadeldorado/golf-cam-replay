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
    <footer className="border-t border-sand bg-cream py-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <span className="font-serif text-lg font-bold text-espresso">ReplaySwing</span>
            <p className="text-sm text-bronze mt-1">
              Made with love for the golf sim community
            </p>
          </div>

          <nav className="flex flex-wrap items-center gap-6">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                {...(link.external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className="inline-flex items-center gap-1.5 text-sm text-bronze hover:text-espresso transition-colors"
              >
                <link.icon size={14} />
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="mt-8 pt-6 border-t border-sand text-center">
          <p className="text-xs text-bronze/60">
            MIT License &middot; &copy; {new Date().getFullYear()} ReplaySwing
          </p>
        </div>
      </div>
    </footer>
  );
}
