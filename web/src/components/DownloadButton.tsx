'use client';

import { Download as DownloadIcon } from 'lucide-react';

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

function trackDownload(fileName?: string, version?: string) {
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'file_download', {
      file_name: fileName ?? 'unknown',
      file_extension: '.exe',
      link_text: `Download ${version ?? 'Latest'}`,
    });
  }
}

export default function DownloadButton({
  href,
  version,
  fileName,
  fallback,
}: {
  href: string;
  version?: string;
  fileName?: string;
  fallback?: boolean;
}) {
  return (
    <a
      href={href}
      {...(fallback ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      onClick={() => trackDownload(fileName, version)}
      className="inline-flex items-center gap-2 rounded-lg bg-lock px-8 py-4 text-lg font-semibold text-ink shadow-lg shadow-lock/20 transition-colors hover:bg-lock-bright"
    >
      <DownloadIcon size={22} />
      Download {version ?? 'Latest'}
    </a>
  );
}
