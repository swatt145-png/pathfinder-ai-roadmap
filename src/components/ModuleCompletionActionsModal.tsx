import { Button } from "@/components/ui/button";
import type { Module } from "@/lib/types";

interface Props {
  completedModuleTitle: string;
  nextModule: Module | null;
  onProceedNext: () => void;
  onReviewRoadmap: () => void;
  onAdaptRoadmap: () => void;
  onClose: () => void;
}

export function ModuleCompletionActionsModal({
  completedModuleTitle,
  nextModule,
  onProceedNext,
  onReviewRoadmap,
  onAdaptRoadmap,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-lg w-full p-6 animate-fade-in">
        <h3 className="font-heading font-bold text-lg mb-2">Module Completed</h3>
        <p className="text-sm text-muted-foreground mb-4">
          You completed <span className="text-foreground font-medium">{completedModuleTitle}</span>.
          Choose what to do next.
        </p>

        <div className="space-y-2">
          <Button
            type="button"
            onClick={onProceedNext}
            disabled={!nextModule}
            className="w-full gradient-primary text-primary-foreground font-heading font-bold"
          >
            {nextModule ? `Proceed to Next Module: ${nextModule.title}` : "No Next Module Available"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReviewRoadmap}
            className="w-full border-white/10 hover:bg-white/5"
          >
            Review Current Roadmap
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onAdaptRoadmap}
            className="w-full border-white/10 hover:bg-white/5"
          >
            Review / Adapt New Roadmap
          </Button>
        </div>
      </div>
    </div>
  );
}
