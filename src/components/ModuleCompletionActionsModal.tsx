import { Button } from "@/components/ui/button";
import type { Module } from "@/lib/types";

interface Props {
  completedModuleTitle: string;
  nextModule: Module | null;
  onProceedNext: () => void;
  onClose: () => void;
}

export function ModuleCompletionActionsModal({
  completedModuleTitle,
  nextModule,
  onProceedNext,
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

        <Button
          type="button"
          onClick={onProceedNext}
          disabled={!nextModule}
          className="w-full gradient-primary text-primary-foreground font-heading font-bold truncate"
        >
          {nextModule ? `Next: ${nextModule.title}` : "No Next Module"}
        </Button>
      </div>
    </div>
  );
}
