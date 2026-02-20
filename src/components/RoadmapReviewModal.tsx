import { Button } from "@/components/ui/button";
import type { RoadmapData, ModuleProgress } from "@/lib/types";

interface Props {
  roadmapData: RoadmapData;
  completedCount: number;
  createdAt: string;
  progressMap: Record<string, ModuleProgress>;
  onClose: () => void;
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function RoadmapReviewModal({ roadmapData, completedCount, createdAt, progressMap, onClose }: Props) {
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

  // Find the first incomplete module to highlight as "next"
  const firstIncompleteId = roadmapData.modules.find(
    (m) => (progressMap[m.id]?.status ?? "not_started") !== "completed"
  )?.id;

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
          {roadmapData.modules.map((module, index) => {
            const status = progressMap[module.id]?.status ?? "not_started";
            const isCompleted = status === "completed";
            const isNext = module.id === firstIncompleteId;
            return (
              <div
                key={module.id}
                className={`glass p-3 transition-all ${
                  isNext
                    ? "border-2 border-primary/60 bg-primary/10 shadow-lg shadow-primary/20 ring-1 ring-primary/30"
                    : isCompleted
                    ? "opacity-60 border border-transparent"
                    : "border border-transparent"
                }`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-heading font-semibold">
                    {index + 1}. {module.title}
                  </p>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-heading font-semibold shrink-0 ml-2 ${
                    isCompleted ? "bg-success/20 text-success" :
                    isNext ? "bg-primary/20 text-primary border border-primary/40" :
                    "bg-muted/50 text-muted-foreground"
                  }`}>
                    {isCompleted ? "Completed ✓" : isNext ? "Up Next →" : "Pending"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Week {module.week} · Days {module.day_start}-{module.day_end} · {module.estimated_hours}h
                </p>
                <p className="text-xs text-muted-foreground mt-1">{module.description}</p>
              </div>
            );
          })}
        </div>

        <Button type="button" variant="outline" onClick={onClose} className="w-full border-border hover:bg-muted">
          Close
        </Button>
      </div>
    </div>
  );
}
