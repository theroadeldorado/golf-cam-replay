import type { Metadata } from 'next';
import { Playfair_Display, Inter } from 'next/font/google';
import GoogleAnalytics from '@/components/GoogleAnalytics';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-serif',
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
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="antialiased">
        <GoogleAnalytics />
        {children}
      </body>
    </html>
  );
}
