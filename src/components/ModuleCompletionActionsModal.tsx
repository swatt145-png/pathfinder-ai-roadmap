import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import type { Module, AdaptationResult } from "@/lib/types";

interface Props {
  completedModuleTitle: string;
  nextModule: Module | null;
  suggestedAdaptation: AdaptationResult | null;
  checkInLoading: boolean;
  onProceedNext: () => void;
  onReturnToRoadmap: () => void;
  onAcceptAdaptation: () => void;
  onAcceptNoScheduleChange: () => void;
  onClose: () => void;
}

export function ModuleCompletionActionsModal({
  completedModuleTitle,
  nextModule,
  suggestedAdaptation,
  checkInLoading,
  onProceedNext,
  onReturnToRoadmap,
  onAcceptAdaptation,
  onAcceptNoScheduleChange,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-lg w-full p-6 animate-fade-in rounded-xl max-h-[90vh] overflow-y-auto">
        <h3 className="font-heading font-bold text-lg mb-1">Module Completed</h3>
        <p className="text-sm text-muted-foreground mb-4">
          <span className="text-foreground font-medium">{completedModuleTitle}</span>
        </p>

        {/* Adaptation suggestion from check-in */}
        {checkInLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4 p-3 glass rounded-lg">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
            <span>Analyzing your performance...</span>
          </div>
        )}

        {suggestedAdaptation && suggestedAdaptation.updated_roadmap && (
          <div className="mb-4 animate-fade-in">
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-3">
              <p className="text-sm font-heading font-semibold text-primary mb-1">Suggested Adjustment</p>
              <p className="text-sm text-muted-foreground mb-2">{suggestedAdaptation.message_to_student}</p>
              <p className="text-xs text-muted-foreground">{suggestedAdaptation.changes_summary}</p>
            </div>
            <div className="space-y-2 mb-3">
              <Button
                type="button"
                onClick={onAcceptAdaptation}
                className="w-full gradient-primary text-primary-foreground font-heading font-bold"
              >
                Accept Update
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onAcceptNoScheduleChange}
                className="w-full border-border hover:bg-muted"
              >
                Accept (Keep Schedule)
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Button
            type="button"
            onClick={onProceedNext}
            disabled={!nextModule}
            className={`w-full font-heading font-bold h-auto min-h-[2.75rem] py-3 whitespace-normal text-left ${
              suggestedAdaptation?.updated_roadmap
                ? "border-border hover:bg-muted"
                : "gradient-primary text-primary-foreground"
            }`}
            variant={suggestedAdaptation?.updated_roadmap ? "outline" : "default"}
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
