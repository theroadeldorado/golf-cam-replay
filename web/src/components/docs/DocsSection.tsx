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
    <section id={section.id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-6">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-cream border border-sand flex items-center justify-center flex-shrink-0">
            <Icon size={20} className="text-gold" />
          </div>
        )}
        <h2 className="font-serif text-2xl md:text-3xl font-bold text-espresso">
          {section.title}
        </h2>
      </div>
      <div
        className="docs-prose"
        dangerouslySetInnerHTML={{ __html: section.content }}
      />
    </section>
  );
}
