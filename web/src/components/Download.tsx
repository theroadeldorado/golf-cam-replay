import { ExternalLink } from 'lucide-react';
import { getLatestRelease, formatBytes } from '@/lib/github';
import DownloadButton from './DownloadButton';

function WindowsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
  );
}

export default async function Download() {
  const release = await getLatestRelease();

  return (
    <section id="download" className="border-t border-line bg-panel/40 py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">Download</p>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Download ReplaySwing
          </h2>
          <p className="mt-4 text-lg text-muted">
            Free and open source. No account needed, no strings attached.
          </p>

          <div className="mt-10 flex justify-center">
            <div className="flex w-full max-w-md flex-col items-center rounded-2xl border border-line bg-panel p-8">
              <div className="mb-6 flex items-center justify-center gap-2 font-mono text-xs uppercase tracking-wider text-muted">
                <WindowsIcon size={18} />
                <span>Windows 10 / 11</span>
              </div>

              {release?.windows && release.version ? (
                <>
                  <DownloadButton
                    href={release.windows.downloadUrl}
                    version={release.version}
                    fileName={release.windows.fileName}
                  />
                  <p className="mt-4 font-mono text-xs text-muted">
                    {release.windows.fileName} &middot; {formatBytes(release.windows.fileSize)}
                  </p>
                </>
              ) : (
                <DownloadButton
                  href="https://github.com/theroadeldorado/replay-swing/releases/latest"
                  fallback
                />
              )}
            </div>
          </div>

          <div className="mt-6">
            <a
              href="https://github.com/theroadeldorado/replay-swing/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-lock-bright transition-colors hover:text-fg"
            >
              View all releases on GitHub
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
