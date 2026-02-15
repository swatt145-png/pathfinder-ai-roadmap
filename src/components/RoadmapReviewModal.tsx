import { Button } from "@/components/ui/button";
import type { RoadmapData } from "@/lib/types";

interface Props {
  roadmapData: RoadmapData;
  completedCount: number;
  createdAt: string;
  onClose: () => void;
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RoadmapReviewModal({ roadmapData, completedCount, createdAt, onClose }: Props) {
  const totalModules = roadmapData.modules.length;
  const remainingModules = Math.max(totalModules - completedCount, 0);
  const totalDays = roadmapData.timeline_weeks * 7;

  const startDate = new Date(createdAt);
  const now = new Date();
  const elapsedDays = Math.max(Math.floor((now.getTime() - startDate.getTime()) / 86400000), 0);
  const remainingDays = Math.max(totalDays - elapsedDays, 0);
  const remainingWeeks = Number((remainingDays / 7).toFixed(1));

  const estimatedCompletionDate = new Date(startDate);
  estimatedCompletionDate.setDate(startDate.getDate() + totalDays);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative glass-strong max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6 animate-fade-in">
        <h3 className="font-heading font-bold text-lg mb-2">Current Roadmap Plan</h3>
        <p className="text-sm text-muted-foreground mb-4">{roadmapData.summary}</p>

        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-4 text-sm">
          <p>Total timeline: {roadmapData.timeline_weeks} weeks ({totalDays} days)</p>
          <p>Modules: {completedCount}/{totalModules} completed ({remainingModules} remaining)</p>
          <p>Weeks remaining: {remainingWeeks}</p>
          <p>Estimated completion: {formatDate(estimatedCompletionDate)}</p>
        </div>

        <div className="space-y-2 mb-5">
          {roadmapData.modules.map((module, index) => (
            <div key={module.id} className="glass p-3">
              <p className="text-sm font-heading font-semibold">
                {index + 1}. {module.title}
              </p>
              <p className="text-xs text-muted-foreground">
                Week {module.week} · Days {module.day_start}-{module.day_end} · {module.estimated_hours}h
              </p>
              <p className="text-xs text-muted-foreground mt-1">{module.description}</p>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" onClick={onClose} className="w-full border-white/10 hover:bg-white/5">
          Close
        </Button>
      </div>
    </div>
  );
}
