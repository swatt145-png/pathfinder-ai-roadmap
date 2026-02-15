import { Button } from "@/components/ui/button";
import type { AdaptationResult, RoadmapData } from "@/lib/types";

interface Props {
  result: AdaptationResult;
  currentRoadmap: RoadmapData;
  onAccept: () => void;
  onKeepCurrent: () => void;
  saving?: boolean;
}

function formatDelta(delta: number, unit: string) {
  if (delta === 0) return `No change in ${unit}`;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta} ${unit}`;
}

export function AdaptationNotification({ result, currentRoadmap, onAccept, onKeepCurrent, saving = false }: Props) {
  const proposed = result.updated_roadmap;
  const currentTimelineWeeks = currentRoadmap.timeline_weeks;
  const currentTimelineDays = currentTimelineWeeks * 7;
  const proposedTimelineWeeks = proposed?.timeline_weeks ?? currentTimelineWeeks;
  const proposedTimelineDays = proposedTimelineWeeks * 7;
  const timelineDeltaDays = proposedTimelineDays - currentTimelineDays;

  const currentHoursPerDay = currentRoadmap.hours_per_day;
  const proposedHoursPerDay = proposed?.hours_per_day ?? currentHoursPerDay;
  const hoursDelta = Number((proposedHoursPerDay - currentHoursPerDay).toFixed(2));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { if (!saving) onKeepCurrent(); }} />
      <div className="relative glass-strong max-w-md w-full p-6 animate-fade-in">
        <h3 className="font-heading font-bold text-lg mb-2">Pathfinder Suggests a Roadmap Update</h3>
        
        <div className="glass p-4 mb-4">
          <p className="text-sm text-muted-foreground italic">{result.message_to_student}</p>
        </div>

        <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 mb-6">
          <p className="text-sm mb-3">{result.changes_summary}</p>
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              Timeline: {currentTimelineDays} days ({currentTimelineWeeks} weeks) → {proposedTimelineDays} days ({proposedTimelineWeeks} weeks)
            </p>
            <p>Impact: {formatDelta(timelineDeltaDays, "days")}</p>
            <p>
              Hours/day: {currentHoursPerDay} → {proposedHoursPerDay}
            </p>
            <p>Impact: {formatDelta(hoursDelta, "hours/day")}</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onKeepCurrent}
            disabled={saving}
            className="flex-1 border-white/10 hover:bg-white/5"
          >
            Continue Current Plan
          </Button>
          <Button
            type="button"
            onClick={onAccept}
            disabled={saving || !proposed}
            className="flex-1 gradient-primary text-primary-foreground font-heading font-bold"
          >
            {saving ? "Applying..." : "Accept Updated Roadmap"}
          </Button>
        </div>
      </div>
    </div>
  );
}
