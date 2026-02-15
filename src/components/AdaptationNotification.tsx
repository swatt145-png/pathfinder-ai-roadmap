import { Button } from "@/components/ui/button";
import type { AdaptationResult, RoadmapData } from "@/lib/types";

interface Props {
  result: AdaptationResult;
  currentRoadmap: RoadmapData;
  onAccept: () => void;
  onAcceptNoScheduleChange: () => void;
  onKeepCurrent: () => void;
  saving?: boolean;
}

function formatDelta(delta: number, unit: string) {
  if (delta === 0) return `No change in ${unit}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${unit}`;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getTotalHours(roadmap: RoadmapData | null | undefined) {
  if (!roadmap) return 0;
  const fromModules = Array.isArray(roadmap.modules)
    ? roadmap.modules.reduce((sum, mod) => sum + toNumber(mod.estimated_hours, 0), 0)
    : 0;
  if (fromModules > 0) return Number(fromModules.toFixed(2));
  return Number(toNumber(roadmap.total_hours, 0).toFixed(2));
}

export function AdaptationNotification({
  result,
  currentRoadmap,
  onAccept,
  onAcceptNoScheduleChange,
  onKeepCurrent,
  saving = false,
}: Props) {
  const proposed = result.updated_roadmap;
  const baseHoursPerDay = Math.max(toNumber(currentRoadmap.hours_per_day, 1), 0.1);

  const currentTotalHours = getTotalHours(currentRoadmap);
  const proposedTotalHours = getTotalHours(proposed ?? currentRoadmap);
  const totalHoursDelta = Number((proposedTotalHours - currentTotalHours).toFixed(2));

  // Compute timeline from hours, not from AI's timeline_weeks
  const currentTimelineDays = Math.ceil(currentTotalHours / baseHoursPerDay);
  const proposedTimelineDays = Math.ceil(proposedTotalHours / baseHoursPerDay);
  const timelineDeltaDays = proposedTimelineDays - currentTimelineDays;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!saving) onKeepCurrent(); }} />
      <div className="relative glass-strong max-w-md w-full p-6 animate-fade-in rounded-xl max-h-[90vh] overflow-y-auto">
        <h3 className="font-heading font-bold text-lg mb-3">Suggested Update</h3>

        <div className="bg-primary/10 border border-primary/20 rounded-lg p-3 mb-4">
          <p className="text-sm mb-2 line-clamp-3">{result.changes_summary}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <p>Timeline: {currentTimelineDays}d → {proposedTimelineDays}d</p>
            <p>{formatDelta(timelineDeltaDays, "days")}</p>
            <p>Effort: {currentTotalHours}h → {proposedTotalHours}h</p>
            <p>{formatDelta(totalHoursDelta, "hours")}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            onClick={onAccept}
            disabled={saving || !proposed}
            className="w-full gradient-primary text-primary-foreground font-heading font-bold"
          >
            {saving ? "Applying..." : "Accept Update"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onAcceptNoScheduleChange}
            disabled={saving || !proposed}
            className="w-full border-white/10 hover:bg-white/5"
          >
            {saving ? "Applying..." : "Accept (Keep Schedule)"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onKeepCurrent}
            disabled={saving}
            className="w-full border-white/10 hover:bg-white/5"
          >
            Keep Current Plan
          </Button>
        </div>
      </div>
    </div>
  );
}
