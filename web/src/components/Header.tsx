'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';

const navLinks = [
  { label: 'Features', href: '/#features' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Docs', href: '/docs' },
  { label: 'Download', href: '/#download' },
  { label: 'Support', href: '/#support' },
  { label: 'Report Bug', href: '/#bug-report' },
];

function Wordmark() {
  return (
    <Link href="/" className="font-display text-lg font-extrabold tracking-[0.12em] text-fg">
      REPLAY<span className="text-lock">SWING</span>
    </Link>
  );
}

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-line bg-ink/80 backdrop-blur-md">
      {/* Amber tally strip — the app's "armed / watching" motif */}
      <div className="h-[3px] w-full bg-watch/80" />

      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3.5">
        <Wordmark />

        {/* Desktop nav */}
        <nav className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted transition-colors hover:text-fg"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Mobile toggle */}
        <button
          className="p-2 text-fg md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <nav className="space-y-1 border-t border-line bg-panel px-6 py-4 md:hidden">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="block rounded-md px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-panel-raised hover:text-fg"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
