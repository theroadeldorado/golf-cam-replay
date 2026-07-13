'use client';

import { useEffect, useState } from 'react';
import type { DocSection } from '@/data/docs';

export default function DocsSidebar({ sections }: { sections: DocSection[] }) {
  const [activeId, setActiveId] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    );

    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="sticky top-28 -mr-4 max-h-[calc(100vh-9rem)] overflow-y-auto pr-4">
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
        On this page
      </p>
      <ul className="space-y-0.5 border-l border-line">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={`-ml-px block border-l-2 py-1.5 pl-4 text-sm transition-colors ${
                activeId === section.id
                  ? 'border-lock font-medium text-fg'
                  : 'border-transparent text-muted hover:border-line-bright hover:text-fg'
              }`}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
