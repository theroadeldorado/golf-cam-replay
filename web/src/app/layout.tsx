import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono, Inter } from 'next/font/google';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import './globals.css';

// Matches the desktop app: Archivo wide caps for headings/state words,
// IBM Plex Mono for data labels, Inter for body copy.
const archivo = Archivo({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://replayswing.com'),
  title: 'ReplaySwing — Free Swing Capture & Instant Replay for Golf Simulators',
  description:
    'Record and replay your golf swings automatically. Camera-based swing detection — no microphone — PiP overlay for simulators, phone cameras via QR code. Free & open source.',
  openGraph: {
    title: 'ReplaySwing — Free Swing Capture & Instant Replay for Golf Simulators',
    description:
      'Record and replay your golf swings automatically. Camera-based swing detection — no microphone — PiP overlay for simulators, phone cameras via QR code. Free & open source.',
    type: 'website',
    url: 'https://replayswing.com',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReplaySwing — Free Swing Capture & Instant Replay',
    description:
      'Record and replay your golf swings automatically. Camera-based swing detection — no microphone — PiP overlay for simulators, phone cameras via QR code. Free & open source.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${plexMono.variable} ${inter.variable}`}
    >
      <body className="antialiased">
        <GoogleAnalytics />
        {children}
      </body>
    </html>
  );
}
