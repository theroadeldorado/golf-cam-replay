import {
  Rocket,
  Camera,
  Smartphone,
  Circle,
  Play,
  PictureInPicture2,
  PenTool,
  Columns2,
  Share2,
  FolderOpen,
  Star,
  QrCode,
  Keyboard,
  Settings,
  LifeBuoy,
} from 'lucide-react';
import type { DocSection } from '@/data/docs';
import IllustrationFigure from '@/components/illustrations/IllustrationFigure';

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  Rocket,
  Camera,
  Smartphone,
  Circle,
  Play,
  PictureInPicture2,
  PenTool,
  Columns2,
  Share2,
  FolderOpen,
  Star,
  QrCode,
  Keyboard,
  Settings,
  LifeBuoy,
};

export default function DocsSection({ section }: { section: DocSection }) {
  const Icon = iconMap[section.iconName];

  return (
    <section id={section.id} className="scroll-mt-28">
      <div className="mb-6 flex items-center gap-3">
        {Icon && (
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
            <Icon size={20} className="text-lock" />
          </div>
        )}
        <h2 className="font-display text-2xl font-extrabold tracking-tight text-fg md:text-3xl">
          {section.title}
        </h2>
      </div>

      {section.illustration && (
        <IllustrationFigure name={section.illustration} caption={section.illustrationCaption} />
      )}

      <div className="docs-prose" dangerouslySetInnerHTML={{ __html: section.content }} />
    </section>
  );
}
