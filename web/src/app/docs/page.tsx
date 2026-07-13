import { docSections } from '@/data/docs';
import DocsSidebar from '@/components/docs/DocsSidebar';
import DocsSection from '@/components/docs/DocsSection';

export default function DocsPage() {
  return (
    <div className="pt-28 pb-20 md:pt-36 md:pb-28">
      <div className="mx-auto max-w-7xl px-6">
        {/* Page header */}
        <div className="mb-12 max-w-3xl">
          <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-lock">Docs</p>
          <h1 className="font-display text-4xl font-extrabold tracking-tight text-fg md:text-5xl">
            Documentation
          </h1>
          <p className="mt-4 text-lg text-muted">
            Everything you need to set up and get the most out of ReplaySwing — with a diagram for
            every step.
          </p>
        </div>

        {/* Sidebar + Content */}
        <div className="flex gap-12 lg:gap-16">
          {/* Sidebar — hidden on mobile */}
          <aside className="hidden lg:block w-56 flex-shrink-0">
            <DocsSidebar sections={docSections} />
          </aside>

          {/* Content */}
          <div className="min-w-0 flex-1 space-y-16">
            {docSections.map((section) => (
              <DocsSection key={section.id} section={section} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
