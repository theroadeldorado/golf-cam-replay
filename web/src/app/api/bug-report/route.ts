import { NextRequest, NextResponse } from 'next/server';

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  // Clean up expired entries periodically
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) {
      if (val.resetAt < now) rateLimitMap.delete(key);
    }
  }

  if (!entry || entry.resetAt < now) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 3600_000 });
    return false;
  }

  if (entry.count >= 5) return true;

  entry.count++;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-real-ip')
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'unknown';

    if (isRateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many bug reports. Please try again later.' },
        { status: 429 }
      );
    }

    const raw = await request.text();
    if (raw.length > 64 * 1024) {
      return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
    }
    const body = JSON.parse(raw);
    const {
      title,
      description,
      steps,
      expected,
      honeypot,
      reporterName,
      reporterEmail,
      logs,
      appVersion,
      platform,
      source,
    } = body;

    // Honeypot check
    if (honeypot) {
      // Silently accept to not reveal the honeypot
      return NextResponse.json({ success: true });
    }

    // Validation
    if (!description || typeof description !== 'string' || description.trim().length === 0) {
      return NextResponse.json({ error: 'Description is required.' }, { status: 400 });
    }

    const isDesktopFeedback = source === 'desktop-app'
    const normalizedTitle =
      typeof title === 'string' && title.trim().length > 0
        ? title.trim()
        : description.trim().split('\n')[0].slice(0, 80) || 'Bug report';

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: 'Bug reporting is not configured. Please report issues directly on GitHub.' },
        { status: 500 }
      );
    }

    // Build issue body
    const reporterBits = [
      reporterName?.trim() ? `Name: ${reporterName.trim()}` : null,
      reporterEmail?.trim() ? `Email: ${reporterEmail.trim()}` : null,
      appVersion?.trim() ? `App Version: ${appVersion.trim()}` : null,
      platform?.trim() ? `Platform: ${platform.trim()}` : null,
      source?.trim() ? `Source: ${source.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const sections = [
      `## Description\n${description.trim()}`,
      reporterBits ? `## Reporter\n${reporterBits}` : null,
      steps?.trim() ? `## Steps to Reproduce\n${steps.trim()}` : null,
      expected?.trim() ? `## Expected Behavior\n${expected.trim()}` : null,
      logs?.trim() ? `## Logs\n\`\`\`\n${logs.trim().slice(0, 12000)}\n\`\`\`` : null,
      `---\n*Submitted via ${isDesktopFeedback ? 'ReplaySwing desktop app' : '[replayswing.com](https://replayswing.com)'}*`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const res = await fetch(
      'https://api.github.com/repos/theroadeldorado/replay-swing/issues',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `[${isDesktopFeedback ? 'Feedback' : 'Bug'}] ${normalizedTitle}`,
          body: sections,
          labels: isDesktopFeedback ? ['feedback', 'desktop'] : ['bug', 'user-reported'],
        }),
      }
    );

    if (!res.ok) {
      const errorData = await res.json().catch(() => null);
      console.error('GitHub API error:', res.status, errorData);
      return NextResponse.json(
        { error: 'Failed to create bug report. Please try again or report directly on GitHub.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Bug report error:', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
