import { Button } from "@/components/ui/button";
import type { Module } from "@/lib/types";

interface Props {
  completedModuleTitle: string;
  nextModule: Module | null;
  onProceedNext: () => void;
  onReturnToRoadmap: () => void;
  onClose: () => void;
}

export function ModuleCompletionActionsModal({
  completedModuleTitle,
  nextModule,
  onProceedNext,
  onReturnToRoadmap,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-lg w-full p-6 animate-fade-in rounded-xl">
        <h3 className="font-heading font-bold text-lg mb-1">Module Completed</h3>
        <p className="text-sm text-muted-foreground mb-4">
          <span className="text-foreground font-medium">{completedModuleTitle}</span>
        </p>

        <div className="space-y-2">
          <Button
            type="button"
            onClick={onProceedNext}
            disabled={!nextModule}
            className="w-full gradient-primary text-primary-foreground font-heading font-bold h-auto min-h-[2.75rem] py-3 whitespace-normal text-left"
          >
            <span className="break-words leading-snug">{nextModule ? `Next: ${nextModule.title}` : "No Next Module"}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onReturnToRoadmap}
            className="w-full border-border hover:bg-muted"
          >
            Return to Roadmap
          </Button>
        </div>
      </div>
    </div>
  );
}
