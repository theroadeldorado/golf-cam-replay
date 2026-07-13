'use client';

import { useState } from 'react';
import { Bug, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

export default function BugReport() {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    steps: '',
    expected: '',
    honeypot: '',
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage('');

    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to submit bug report');
      }

      setStatus('success');
      setFormData({ title: '', description: '', steps: '', expected: '', honeypot: '' });
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  };

  const inputClasses =
    'w-full bg-ink border border-line rounded-lg px-4 py-3 text-fg placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-lock/40 focus:border-lock transition-colors text-sm';

  return (
    <section id="bug-report" className="border-t border-line bg-panel/40 py-20 md:py-28">
      <div className="mx-auto max-w-2xl px-6">
        <div className="mb-12 text-center">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fire">Report a bug</p>
          <h2 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Something broken?
          </h2>
          <p className="mt-4 text-lg text-muted">
            Let us know and we&apos;ll fix it. Reports go straight to GitHub.
          </p>
        </div>

        {status === 'success' ? (
          <div className="rounded-2xl border border-lock/30 bg-panel p-8 text-center">
            <CheckCircle size={48} className="mx-auto mb-4 text-lock" />
            <h3 className="mb-2 font-display text-xl font-bold text-fg">Bug report submitted</h3>
            <p className="text-muted">
              Thanks for helping improve ReplaySwing! A GitHub issue has been created and
              we&apos;ll look into it.
            </p>
            <button
              onClick={() => setStatus('idle')}
              className="mt-6 text-sm font-medium text-lock-bright transition-colors hover:text-fg"
            >
              Submit another report
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Honeypot */}
            <input
              type="text"
              name="website"
              value={formData.honeypot}
              onChange={(e) => setFormData({ ...formData, honeypot: e.target.value })}
              className="absolute opacity-0 pointer-events-none"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
            />

            <div>
              <label htmlFor="bug-title" className="mb-2 block text-sm font-medium text-fg">
                Title <span className="text-fire">*</span>
              </label>
              <input
                id="bug-title"
                type="text"
                required
                placeholder="Brief description of the issue"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className={inputClasses}
              />
            </div>

            <div>
              <label htmlFor="bug-description" className="mb-2 block text-sm font-medium text-fg">
                Description <span className="text-fire">*</span>
              </label>
              <textarea
                id="bug-description"
                required
                rows={4}
                placeholder="What happened? What were you doing when the bug occurred?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className={inputClasses}
              />
            </div>

            <div>
              <label htmlFor="bug-steps" className="mb-2 block text-sm font-medium text-fg">
                Steps to Reproduce
              </label>
              <textarea
                id="bug-steps"
                rows={3}
                placeholder="1. Open the app&#10;2. Click on...&#10;3. Observe..."
                value={formData.steps}
                onChange={(e) => setFormData({ ...formData, steps: e.target.value })}
                className={inputClasses}
              />
            </div>

            <div>
              <label htmlFor="bug-expected" className="mb-2 block text-sm font-medium text-fg">
                Expected Behavior
              </label>
              <textarea
                id="bug-expected"
                rows={2}
                placeholder="What did you expect to happen instead?"
                value={formData.expected}
                onChange={(e) => setFormData({ ...formData, expected: e.target.value })}
                className={inputClasses}
              />
            </div>

            {status === 'error' && (
              <div className="flex items-start gap-3 rounded-lg border border-fire/40 bg-fire/10 p-4">
                <AlertCircle size={20} className="mt-0.5 flex-shrink-0 text-fire" />
                <p className="text-sm text-fire">{errorMessage}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'loading'}
              className="inline-flex items-center gap-2 rounded-lg bg-lock px-6 py-3 font-semibold text-ink transition-colors hover:bg-lock-bright disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === 'loading' ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Bug size={18} />
                  Submit Bug Report
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
