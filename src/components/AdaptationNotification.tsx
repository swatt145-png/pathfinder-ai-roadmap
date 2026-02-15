import { Button } from "@/components/ui/button";
import type { AdaptationResult } from "@/lib/types";

interface Props {
  result: AdaptationResult;
  onDismiss: () => void;
}

export function AdaptationNotification({ result, onDismiss }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onDismiss} />
      <div className="relative glass-strong max-w-md w-full p-6 animate-fade-in">
        <h3 className="font-heading font-bold text-lg mb-2">📋 Your Roadmap Has Been Updated!</h3>
        
        <div className="glass p-4 mb-4">
          <p className="text-sm text-muted-foreground italic">{result.message_to_student}</p>
        </div>

        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-6">
          <p className="text-sm">{result.changes_summary}</p>
        </div>

        <Button onClick={onDismiss} className="w-full gradient-primary text-primary-foreground font-heading font-bold">
          Sounds Good!
        </Button>
      </div>
    </div>
  );
}
