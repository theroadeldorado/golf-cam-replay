import {
  AppWindowIllustration,
  GarageSimIllustration,
  PhoneCameraIllustration,
  TallyStatesIllustration,
  PipOverlayIllustration,
  DrawingToolsIllustration,
  CompareSwingsIllustration,
  AutoArmIllustration,
  SessionsIllustration,
} from './Illustrations';

type IllustrationComponent = React.ComponentType<{ className?: string; label?: string }>;

export const illustrationMap: Record<string, IllustrationComponent> = {
  appWindow: AppWindowIllustration,
  garageSim: GarageSimIllustration,
  phoneCamera: PhoneCameraIllustration,
  tallyStates: TallyStatesIllustration,
  pipOverlay: PipOverlayIllustration,
  drawingTools: DrawingToolsIllustration,
  compareSwings: CompareSwingsIllustration,
  autoArm: AutoArmIllustration,
  sessions: SessionsIllustration,
};

export type IllustrationKey = keyof typeof illustrationMap;

/** A framed figure — a schematic illustration standing in for a screenshot,
 *  with a monospace caption in the app's voice. */
export default function IllustrationFigure({
  name,
  caption,
}: {
  name: string;
  caption?: string;
}) {
  const Illustration = illustrationMap[name];
  if (!Illustration) return null;

  return (
    <figure className="my-6 overflow-hidden rounded-xl border border-line bg-ink/60 p-3 sm:p-4">
      <Illustration className="block" label={caption} />
      {caption && (
        <figcaption className="mt-3 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-wider text-faint">
          <span className="inline-block h-1.5 w-1.5 rounded-[1px] bg-lock" />
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
