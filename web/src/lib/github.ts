export interface AssetInfo {
  downloadUrl: string;
  fileName: string;
  fileSize: number;
}

export interface ReleaseInfo {
  version: string;
  publishedAt: string;
  htmlUrl: string;
  windows: AssetInfo | null;
}

export async function getLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    // Fetch all releases (includes prereleases, which /releases/latest skips)
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    const res = await fetch(
      'https://api.github.com/repos/theroadeldorado/replay-swing/releases?per_page=5',
      {
        headers,
        next: { revalidate: 60 },
      }
    );

    if (!res.ok) return null;

    const releases = await res.json();

    // Find the first release with a platform asset
    for (const release of releases) {
      const exeAsset = release.assets?.find(
        (a: { name: string }) => a.name.endsWith('.exe')
      );
      if (exeAsset) {
        const toAssetInfo = (a: { browser_download_url: string; name: string; size: number }): AssetInfo => ({
          downloadUrl: a.browser_download_url,
          fileName: a.name,
          fileSize: a.size,
        });
        return {
          version: release.tag_name,
          publishedAt: release.published_at,
          htmlUrl: release.html_url,
          windows: toAssetInfo(exeAsset),
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
