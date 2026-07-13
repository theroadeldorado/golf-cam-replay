# replayswing.com

Marketing website for [ReplaySwing](https://github.com/theroadeldorado/replay-swing) — a free, open-source Windows app for recording and analyzing golf swings with audio-triggered capture, multi-camera support, and PiP overlay for golf simulators.

**Live site:** [replayswing.com](https://replayswing.com)

## Tech Stack

- **Next.js 16** (App Router)
- **Tailwind CSS v4**
- **TypeScript**
- **Lucide React** (icons)
- **Vercel** (hosting)

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values:

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes | Bug-report form + latest-release download links. Needs **Issues: Read and write** on `theroadeldorado/replay-swing`. |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` | Optional | Google Analytics 4 measurement ID. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Prod only | Backs the phone-camera signaling relay (`/api/signal`). Local dev falls back to an in-memory store. |

`GITHUB_TOKEN` is used by:

- **Bug report form** (`/api/bug-report`) — creates GitHub issues from user submissions
- **Download section** — fetches the latest release info from the GitHub API (revalidates hourly)

## Project Structure

```
src/
├── app/
│   ├── layout.tsx              # Root layout, fonts, metadata
│   ├── page.tsx                # Landing page
│   ├── globals.css             # Tailwind theme + custom styles
│   ├── docs/                   # Documentation page
│   ├── camera/                 # Phone-camera capture page (opened via QR)
│   └── api/
│       ├── bug-report/route.ts             # GitHub Issues API proxy
│       └── signal/[session]/[role]/route.ts # WebRTC signaling relay (Redis)
├── components/                 # Header, Hero, Features, HowItWorks,
│   │                           #   PipDemo, Download(+Button), Support,
│   │                           #   BugReport, Footer, GoogleAnalytics
│   ├── docs/                   # Docs page components
│   └── illustrations/          # Inline SVG illustrations
├── data/
│   └── docs.ts                 # Documentation content data
└── lib/                        # github.ts (GitHub API) + signaling.ts helpers
```

## Deployment

The site auto-deploys to Vercel on push to `main`. To deploy manually:

```bash
vercel --prod
```

Add `GITHUB_TOKEN` in Vercel dashboard under Project Settings > Environment Variables.
