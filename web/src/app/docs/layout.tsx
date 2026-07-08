import type { Metadata } from 'next';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Documentation — ReplaySwing',
  description:
    'Complete documentation for ReplaySwing: camera setup, phone pairing, swing detection, recording, PiP overlay, sessions, keyboard shortcuts, and more.',
};

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
